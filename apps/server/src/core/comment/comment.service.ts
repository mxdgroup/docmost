import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateCommentDto, yjsSelectionSchema } from './dto/create-comment.dto';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { Comment, Page, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { CursorPaginationResult } from '@docmost/db/pagination/cursor-pagination';
import { QueueJob, QueueName } from '../../integrations/queue/constants';
import { extractUserMentionIdsFromJson } from '../../common/helpers/prosemirror/utils';
import { ICommentNotificationJob } from '../../integrations/queue/constants/queue.interface';
import { WsService } from '../../ws/ws.service';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(
    private commentRepo: CommentRepo,
    private pageRepo: PageRepo,
    private wsService: WsService,
    private collaborationGateway: CollaborationGateway,
    @InjectQueue(QueueName.GENERAL_QUEUE)
    private generalQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_QUEUE)
    private notificationQueue: Queue,
  ) {}

  async findById(commentId: string) {
    const comment = await this.commentRepo.findById(commentId, {
      includeCreator: true,
      includeResolvedBy: true,
    });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  async create(
    opts: { page: Page; workspaceId: string; user: User },
    createCommentDto: CreateCommentDto,
  ) {
    const { page, workspaceId, user } = opts;
    const commentContent = JSON.parse(createCommentDto.content);

    if (createCommentDto.parentCommentId) {
      const parentComment = await this.commentRepo.findById(
        createCommentDto.parentCommentId,
      );

      if (!parentComment || parentComment.pageId !== page.id) {
        throw new BadRequestException('Parent comment not found');
      }

      if (parentComment.parentCommentId !== null) {
        throw new BadRequestException('You cannot reply to a reply');
      }
    }

    const inserted = await this.commentRepo.insertComment({
      pageId: page.id,
      content: commentContent,
      selection: createCommentDto?.selection?.substring(0, 250) ?? null,
      type: createCommentDto.type ?? 'page',
      parentCommentId: createCommentDto?.parentCommentId,
      creatorId: user.id,
      workspaceId: workspaceId,
      spaceId: page.spaceId,
    });

    if (createCommentDto.yjsSelection) {
      const parsed = yjsSelectionSchema.safeParse(createCommentDto.yjsSelection);
      if (!parsed.success) {
        this.logger.warn(
          `Invalid yjsSelection for comment ${inserted.id}: ${parsed.error.message}`,
        );
      } else {
        const documentName = `page.${page.id}`;
        try {
          await this.collaborationGateway.handleYjsEvent(
            'setCommentMark',
            documentName,
            {
              yjsSelection: parsed.data,
              commentId: inserted.id,
              resolved: false,
              user,
            },
          );
        } catch (error) {
          this.logger.warn(
            `Failed to apply comment mark for comment ${inserted.id}, comment saved without inline highlight`,
            error,
          );
        }
      }
    }

    const comment = await this.commentRepo.findById(inserted.id, {
      includeCreator: true,
      includeResolvedBy: true,
    });

    this.generalQueue
      .add(QueueJob.ADD_PAGE_WATCHERS, {
        userIds: [user.id],
        pageId: page.id,
        spaceId: page.spaceId,
        workspaceId,
      })
      .catch((err) =>
        this.logger.warn(`Failed to queue add-page-watchers: ${err.message}`),
      );

    const isReply = !!createCommentDto.parentCommentId;

    await this.queueCommentNotification(
      commentContent,
      [],
      comment.id,
      page.id,
      page.spaceId,
      workspaceId,
      user.id,
      !isReply,
      createCommentDto.parentCommentId,
    );

    this.wsService.emitCommentEvent(page.spaceId, page.id, {
      operation: 'commentCreated',
      pageId: page.id,
      comment,
    });

    return comment;
  }

  // MXD: anonymous comment on a shared page. Content arrives ALREADY
  // sanitized by the share layer's allowlist (which also strips mention
  // nodes, so guests can't trigger mention notifications). No user: no
  // watcher registration, no mention jobs — only the reply notification to the
  // parent author and page watchers. An inline comment (yjsSelection) gets its
  // highlight applied server-side, the same path read-only members use.
  //
  // Returns the one-time ownership secret alongside the comment: the posting
  // browser keeps it to edit/delete this comment later; only its hash is
  // stored.
  async createGuestComment(
    opts: {
      page: Page;
      workspaceId: string;
      guestName: string;
      sanitizedContent: any;
    },
    dto: {
      parentCommentId?: string;
      selection?: string;
      type?: string;
      yjsSelection?: unknown;
    },
  ): Promise<{ comment: Comment; guestToken: string }> {
    const { page, workspaceId, guestName, sanitizedContent } = opts;

    if (dto.parentCommentId) {
      const parentComment = await this.commentRepo.findById(
        dto.parentCommentId,
      );
      if (!parentComment || parentComment.pageId !== page.id) {
        throw new BadRequestException('Parent comment not found');
      }
      if (parentComment.parentCommentId !== null) {
        throw new BadRequestException('You cannot reply to a reply');
      }
    }

    // Only a top-level comment can anchor to a text selection.
    const isInline = !dto.parentCommentId && !!dto.yjsSelection;

    const inserted = await this.commentRepo.insertComment({
      pageId: page.id,
      content: sanitizedContent,
      selection: isInline ? (dto.selection?.substring(0, 250) ?? null) : null,
      type: isInline ? 'inline' : 'page',
      parentCommentId: dto?.parentCommentId,
      creatorId: null,
      guestName,
      workspaceId,
      spaceId: page.spaceId,
    });

    const guestToken = randomBytes(32).toString('base64url');
    await this.commentRepo.insertGuestCommentToken(
      inserted.id,
      hashGuestToken(guestToken),
    );

    if (isInline) {
      await this.applyCommentMark(page.id, inserted.id, dto.yjsSelection, null);
    }

    const comment = await this.commentRepo.findById(inserted.id, {
      includeCreator: true,
      includeResolvedBy: true,
    });

    const isReply = !!dto.parentCommentId;
    await this.queueCommentNotification(
      sanitizedContent, // mention-free by construction
      [],
      comment.id,
      page.id,
      page.spaceId,
      workspaceId,
      null,
      !isReply,
      dto.parentCommentId,
    );

    this.wsService.emitCommentEvent(page.spaceId, page.id, {
      operation: 'commentCreated',
      pageId: page.id,
      comment,
    });

    return { comment, guestToken };
  }

  // MXD: true only when `guestToken` is the ownership secret minted for this
  // guest comment. Member comments never have one, so guests can't touch them.
  async isGuestCommentOwner(
    comment: Comment,
    guestToken: string | undefined,
  ): Promise<boolean> {
    if (comment.creatorId !== null || !guestToken) return false;
    const storedHash = await this.commentRepo.findGuestCommentTokenHash(
      comment.id,
    );
    if (!storedHash) return false;
    const a = Buffer.from(storedHash);
    const b = Buffer.from(hashGuestToken(guestToken));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async updateGuestComment(
    comment: Comment,
    sanitizedContent: any,
  ): Promise<Comment> {
    const editedAt = new Date();
    await this.commentRepo.updateComment(
      { content: sanitizedContent, editedAt, updatedAt: editedAt },
      comment.id,
    );
    const updated = await this.commentRepo.findById(comment.id, {
      includeCreator: true,
      includeResolvedBy: true,
    });
    this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
      operation: 'commentUpdated',
      pageId: comment.pageId,
      comment: updated,
    });
    return updated;
  }

  async deleteGuestComment(comment: Comment): Promise<void> {
    // A guest's read-only editor can't remove the highlight itself, so the
    // server does it before the row (and its replies, via FK cascade) goes.
    if (!comment.parentCommentId && comment.type === 'inline') {
      try {
        await this.collaborationGateway.handleYjsEvent(
          'unsetCommentMark',
          `page.${comment.pageId}`,
          { commentId: comment.id, user: null },
        );
      } catch (error) {
        this.logger.warn(
          `Failed to remove comment mark for comment ${comment.id}`,
          error,
        );
      }
    }
    await this.commentRepo.deleteComment(comment.id);
    this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
      operation: 'commentDeleted',
      pageId: comment.pageId,
      commentId: comment.id,
    });
  }

  // MXD: fork-owned thread resolution (the upstream feature is EE-licensed and
  // unlicensed on this deployment). Shared by members and share guests: a
  // member resolves as `user`, a guest as `guestName`. Updates the row, flips
  // the highlight's `resolved` attribute in the ydoc, and broadcasts.
  async resolveComment(
    comment: Comment,
    resolved: boolean,
    actor: { user?: User; guestName?: string },
  ): Promise<Comment> {
    if (comment.parentCommentId) {
      throw new BadRequestException('Only top-level comments can be resolved');
    }

    const now = new Date();
    await this.commentRepo.updateComment(
      resolved
        ? {
            resolvedAt: now,
            resolvedById: actor.user?.id ?? null,
            resolvedByGuestName: actor.user ? null : (actor.guestName ?? null),
            updatedAt: now,
          }
        : {
            resolvedAt: null,
            resolvedById: null,
            resolvedByGuestName: null,
            updatedAt: now,
          },
      comment.id,
    );

    if (comment.type === 'inline') {
      try {
        await this.collaborationGateway.handleYjsEvent(
          'resolveCommentMark',
          `page.${comment.pageId}`,
          { commentId: comment.id, resolved, user: actor.user ?? null },
        );
      } catch (error) {
        this.logger.warn(
          `Failed to update comment mark for comment ${comment.id}`,
          error,
        );
      }
    }

    const updated = await this.commentRepo.findById(comment.id, {
      includeCreator: true,
      includeResolvedBy: true,
    });
    this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
      operation: 'commentResolved',
      pageId: comment.pageId,
      comment: updated,
    });
    return updated;
  }

  private async applyCommentMark(
    pageId: string,
    commentId: string,
    yjsSelection: unknown,
    user: User | null,
  ): Promise<void> {
    const parsed = yjsSelectionSchema.safeParse(yjsSelection);
    if (!parsed.success) {
      this.logger.warn(
        `Invalid yjsSelection for comment ${commentId}: ${parsed.error.message}`,
      );
      return;
    }
    try {
      await this.collaborationGateway.handleYjsEvent(
        'setCommentMark',
        `page.${pageId}`,
        { yjsSelection: parsed.data, commentId, resolved: false, user },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to apply comment mark for comment ${commentId}, comment saved without inline highlight`,
        error,
      );
    }
  }

  async findByPageId(
    pageId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<Comment>> {
    const page = await this.pageRepo.findById(pageId);

    if (!page) {
      throw new BadRequestException('Page not found');
    }

    return this.commentRepo.findPageComments(pageId, pagination);
  }

  async update(
    comment: Comment,
    updateCommentDto: UpdateCommentDto,
    authUser: User,
  ): Promise<Comment> {
    const commentContent = JSON.parse(updateCommentDto.content);

    if (comment.creatorId !== authUser.id) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const oldMentionIds = extractUserMentionIdsFromJson(comment.content);

    const editedAt = new Date();

    await this.commentRepo.updateComment(
      {
        content: commentContent,
        editedAt: editedAt,
        updatedAt: editedAt,
      },
      comment.id,
    );

    await this.queueCommentNotification(
      commentContent,
      oldMentionIds,
      comment.id,
      comment.pageId,
      comment.spaceId,
      comment.workspaceId,
      authUser.id,
      false,
    );

    comment.content = commentContent;
    comment.editedAt = editedAt;
    comment.updatedAt = editedAt;

    this.wsService.emitCommentEvent(comment.spaceId, comment.pageId, {
      operation: 'commentUpdated',
      pageId: comment.pageId,
      comment,
    });

    return comment;
  }

  private async queueCommentNotification(
    content: any,
    oldMentionIds: string[],
    commentId: string,
    pageId: string,
    spaceId: string,
    workspaceId: string,
    actorId: string | null,
    notifyWatchers: boolean,
    parentCommentId?: string,
  ) {
    const mentionedUserIds = extractUserMentionIdsFromJson(content);
    const newMentionIds = mentionedUserIds.filter(
      (id) => id !== actorId && !oldMentionIds.includes(id),
    );

    if (newMentionIds.length === 0 && !notifyWatchers && !parentCommentId) return;

    const jobData: ICommentNotificationJob = {
      commentId,
      parentCommentId,
      pageId,
      spaceId,
      workspaceId,
      actorId,
      mentionedUserIds: newMentionIds,
      notifyWatchers,
    };

    await this.notificationQueue.add(
      QueueJob.COMMENT_NOTIFICATION,
      jobData,
    );
  }
}
