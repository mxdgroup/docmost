import {
  BadRequestException,
  Logger,
  Req,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { Comment, User, Workspace } from '@docmost/db/types/entity.types';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { ShareService } from './share.service';
import {
  CreateShareDto,
  ShareCollabTokenDto,
  ShareCommentsListDto,
  ShareGuestCommentDto,
  ShareGuestCommentOwnedDto,
  ShareGuestCommentResolveDto,
  ShareGuestCommentUpdateDto,
  ShareIdDto,
  ShareInfoDto,
  SharePageIdDto,
  UpdateShareDto,
} from './dto/share.dto';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SHARE_PUBLIC_THROTTLER } from '../../integrations/throttle/throttler-names';
import { ShareTransclusionLookupDto } from './dto/share-transclusion-lookup.dto';
import { sanitizeGuestCommentContent } from './guest-comment-content';
import { CommentService } from '../comment/comment.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { PageAccessService } from '../page/page-access/page-access.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { LicenseCheckService } from '../../integrations/environment/license-check.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';

@UseGuards(JwtAuthGuard)
@Controller('shares')
export class ShareController {
  private readonly logger = new Logger(ShareController.name);

  constructor(
    private readonly shareService: ShareService,
    private readonly commentService: CommentService,
    private readonly commentRepo: CommentRepo,
    private readonly shareRepo: ShareRepo,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly licenseCheckService: LicenseCheckService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async getShares(
    @AuthUser() user: User,
    @Body() pagination: PaginationOptions,
  ) {
    return this.shareRepo.getShares(user.id, pagination);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/page-info')
  async getSharedPageInfo(
    @Body() dto: ShareInfoDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (!dto.pageId && !dto.shareId) {
      throw new BadRequestException();
    }

    const shareData = await this.shareService.getSharedPage(dto, workspace.id);

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      shareData.share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Shared page not found');
    }

    return {
      ...shareData,
      features: this.licenseCheckService.resolveFeatures(
        workspace.licenseKey,
        workspace.plan,
      ),
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/info')
  async getShare(@Body() dto: ShareIdDto) {
    const share = await this.shareRepo.findById(dto.shareId, {
      includeSharedPage: true,
    });

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    const sharingAllowed = await this.shareService.isSharingAllowed(
      share.workspaceId,
      share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Share not found');
    }

    return share;
  }

  // MXD: anonymous, throttled. Returns a short-lived SHARE_COLLAB token for
  // an edit-mode share; the ws auth extension re-validates everything again.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('/collab-token')
  async mintCollabToken(
    @Body() dto: ShareCollabTokenDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: any,
  ) {
    const result = await this.shareService.mintShareCollabToken(
      dto.shareId,
      dto.pageId,
      workspace.id,
    );
    // Abuse forensics: minimal per-session record (truncated IP — enough to
    // distinguish one actor from many after an incident, not an identity
    // system). Retention = log retention.
    const ip = String(req?.ip ?? '').replace(/[.:][^.:]*$/, '.x');
    this.logger.log(
      `share-collab token minted: share=${dto.shareId} page=${dto.pageId} ip=${ip}`,
    );
    return result;
  }

  // MXD: guest comment listing on a shared page (comment/edit modes).
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 60 } })
  @HttpCode(HttpStatus.OK)
  @Post('/comments')
  async listGuestComments(
    @Body() dto: ShareCommentsListDto,
    @Body() pagination: PaginationOptions,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { page } = await this.shareService.validateGuestCommentAccess(
      dto.shareId,
      dto.pageId,
      workspace.id,
    );
    return this.commentService.findByPageId(page.id, pagination);
  }

  // MXD: guest comment creation. Body content passes the restricted
  // allowlist (no embeds/raw HTML/mentions; http(s) links only) before it
  // ever reaches the comment service. Returns the comment plus a one-time
  // `guestToken` the browser keeps to edit/delete it later.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('/comments/create')
  async createGuestComment(
    @Body() dto: ShareGuestCommentDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: any,
  ) {
    const { page } = await this.shareService.validateGuestCommentAccess(
      dto.shareId,
      dto.pageId,
      workspace.id,
    );

    const sanitized = parseGuestContent(dto.content);
    const guestName = parseGuestName(dto.guestName);

    const { comment, guestToken } =
      await this.commentService.createGuestComment(
        {
          page,
          workspaceId: workspace.id,
          guestName,
          sanitizedContent: sanitized,
        },
        {
          parentCommentId: dto.parentCommentId,
          selection: dto.selection,
          yjsSelection: dto.yjsSelection,
        },
      );

    this.logger.log(
      `guest comment created: share=${dto.shareId} page=${dto.pageId} comment=${comment.id} ip=${truncatedIp(req)}`,
    );

    return { ...comment, guestToken };
  }

  // MXD: a guest edits a comment it created (proven by its guestToken).
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('/comments/update')
  async updateGuestComment(
    @Body() dto: ShareGuestCommentUpdateDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const comment = await this.findGuestTargetComment(dto, workspace.id);
    await this.assertGuestOwner(comment, dto.guestToken);
    return this.commentService.updateGuestComment(
      comment,
      parseGuestContent(dto.content),
    );
  }

  // MXD: a guest deletes a comment it created (replies cascade, as for members).
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('/comments/delete')
  async deleteGuestComment(
    @Body() dto: ShareGuestCommentOwnedDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: any,
  ) {
    const comment = await this.findGuestTargetComment(dto, workspace.id);
    await this.assertGuestOwner(comment, dto.guestToken);
    await this.commentService.deleteGuestComment(comment);
    this.logger.log(
      `guest comment deleted: share=${dto.shareId} comment=${comment.id} ip=${truncatedIp(req)}`,
    );
  }

  // MXD: any guest on a commentable link can resolve or re-open a thread
  // (product decision 2026-09-14), attributed to their display name.
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.OK)
  @Post('/comments/resolve')
  async resolveGuestComment(
    @Body() dto: ShareGuestCommentResolveDto,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: any,
  ) {
    const comment = await this.findGuestTargetComment(dto, workspace.id);
    const updated = await this.commentService.resolveComment(
      comment,
      dto.resolved,
      { guestName: parseGuestName(dto.guestName) },
    );
    this.logger.log(
      `guest comment ${dto.resolved ? 'resolved' : 'reopened'}: share=${dto.shareId} comment=${comment.id} ip=${truncatedIp(req)}`,
    );
    return updated;
  }

  // Resolves the comment, then runs the full guest access ladder against the
  // comment's OWN page — a guest can only act on comments the share covers.
  private async findGuestTargetComment(
    dto: { shareId: string; commentId: string },
    workspaceId: string,
  ) {
    const comment = await this.commentRepo.findById(dto.commentId);
    if (!comment || comment.workspaceId !== workspaceId) {
      throw new NotFoundException('Comment not found');
    }
    await this.shareService.validateGuestCommentAccess(
      dto.shareId,
      comment.pageId,
      workspaceId,
    );
    return comment;
  }

  private async assertGuestOwner(comment: Comment, guestToken: string) {
    const isOwner = await this.commentService.isGuestCommentOwner(
      comment,
      guestToken,
    );
    if (!isOwner) {
      throw new ForbiddenException('You can only change your own comments');
    }
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/transclusion/lookup')
  async transclusionLookup(
    @Body() dto: ShareTransclusionLookupDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.shareService.lookupTransclusionForShare(
      dto.shareId,
      dto.references,
      workspace.id,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('/for-page')
  async getShareForPage(
    @Body() dto: SharePageIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(dto.pageId);
    if (!page) {
      throw new NotFoundException('Shared page not found');
    }

    await this.pageAccessService.validateCanView(page, user);

    return this.shareService.getShareForPage(page.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() createShareDto: CreateShareDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.pageRepo.findById(createShareDto.pageId);

    if (!page || workspace.id !== page.workspaceId) {
      throw new NotFoundException('Page not found');
    }

    // User must be able to edit the page to create a share
    //TODO: i dont think this is neccessary if we prevent restricted pages from getting shared
    // rather, use space level permission and workspace/space level sharing restriction
    await this.pageAccessService.validateCanEdit(page, user);

    // Prevent sharing restricted pages
    const isRestricted = await this.pagePermissionRepo.hasRestrictedAncestor(
      page.id,
    );
    if (isRestricted) {
      throw new BadRequestException('Cannot share a restricted page');
    }

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      page.spaceId,
    );
    if (!sharingAllowed) {
      throw new ForbiddenException('Public sharing is disabled');
    }

    const share = await this.shareService.createShare({
      page,
      authUserId: user.id,
      workspaceId: workspace.id,
      createShareDto,
    });

    this.auditService.log({
      event: AuditEvent.SHARE_CREATED,
      resourceType: AuditResource.SHARE,
      resourceId: share.id,
      spaceId: page.spaceId,
      metadata: {
        pageId: page.id,
        spaceId: page.spaceId,
      },
    });

    return share;
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(@Body() updateShareDto: UpdateShareDto, @AuthUser() user: User) {
    const share = await this.shareRepo.findById(updateShareDto.shareId);

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    const page = await this.pageRepo.findById(share.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // User must be able to edit the page to update its share
    await this.pageAccessService.validateCanEdit(page, user);

    return this.shareService.updateShare(share.id, updateShareDto);
  }


  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(@Body() shareIdDto: ShareIdDto, @AuthUser() user: User) {
    const share = await this.shareRepo.findById(shareIdDto.shareId);

    if (!share) {
      throw new NotFoundException('Share not found');
    }

    const page = await this.pageRepo.findById(share.pageId);
    if (!page) {
      throw new NotFoundException('Page not found');
    }

    // User must be able to edit the page to delete its share
    await this.pageAccessService.validateCanEdit(page, user);

    await this.shareRepo.deleteShare(share.id);

    this.auditService.log({
      event: AuditEvent.SHARE_DELETED,
      resourceType: AuditResource.SHARE,
      resourceId: share.id,
      spaceId: share.spaceId,
      changes: {
        before: {
          pageId: share.pageId,
          spaceId: share.spaceId,
        },
      },
    });
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('/tree')
  async getSharePageTree(
    @Body() dto: ShareIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const treeData = await this.shareService.getShareTree(
      dto.shareId,
      workspace.id,
    );

    const sharingAllowed = await this.shareService.isSharingAllowed(
      workspace.id,
      treeData.share.spaceId,
    );
    if (!sharingAllowed) {
      throw new NotFoundException('Share not found');
    }

    return {
      ...treeData,
      features: this.licenseCheckService.resolveFeatures(
        workspace.licenseKey,
        workspace.plan,
      ),
    };
  }
}

// Parse + sanitize an unauthenticated comment body; 400 if nothing survives.
function parseGuestContent(content: string): any {
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new BadRequestException('Invalid comment content');
  }
  const sanitized = sanitizeGuestCommentContent(parsed);
  if (!sanitized) {
    throw new BadRequestException('Comment content is empty or not allowed');
  }
  return sanitized;
}

function parseGuestName(name: string): string {
  const guestName = String(name ?? '').trim().slice(0, 50);
  if (!guestName) {
    throw new BadRequestException('Display name is required');
  }
  return guestName;
}

// Abuse forensics: enough to tell one actor from many, not an identity system.
function truncatedIp(req: any): string {
  return String(req?.ip ?? '').replace(/[.:][^.:]*$/, '.x');
}
