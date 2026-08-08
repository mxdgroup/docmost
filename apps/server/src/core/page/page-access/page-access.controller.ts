// MXD (plan Unit 8): HTTP surface for page-permission management. Every UI
// capability lands here first (agent-native parity). Audited per mutation.
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { PageAccessManagementService } from './page-access-management.service';
import {
  AuditEvent,
  AuditEventType,
  AuditResource,
} from '../../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';

class PageTargetDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

class AddMembersDto extends PageTargetDto {
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  userIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  groupIds?: string[];

  @IsIn(['writer', 'reader'])
  role: string;
}

class MemberTargetDto extends PageTargetDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

class UpdateRoleDto extends MemberTargetDto {
  @IsIn(['writer', 'reader'])
  role: string;
}

@UseGuards(JwtAuthGuard)
@Controller('pages/permissions')
export class PageAccessController {
  constructor(
    private readonly management: PageAccessManagementService,
    private readonly pageRepo: PageRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  private async requirePage(pageId: string, workspaceId: string) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  private audit(
    event: AuditEventType,
    page: any,
    metadata: Record<string, any>,
  ) {
    this.auditService.log({
      event,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      metadata: { pageId: page.id, ...metadata },
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('restrict')
  async restrict(
    @Body() dto: PageTargetDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    const access = await this.management.restrict(page, user, workspace.id);
    this.audit(AuditEvent.PAGE_RESTRICTED, page, {});
    return access;
  }

  @HttpCode(HttpStatus.OK)
  @Post('open')
  async open(
    @Body() dto: PageTargetDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    await this.management.open(page, user);
    this.audit(AuditEvent.PAGE_RESTRICTION_REMOVED, page, {});
  }

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async listMembers(
    @Body() dto: PageTargetDto,
    @Body() pagination: PaginationOptions,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    return this.management.listMembers(page, user, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('add-members')
  async addMembers(
    @Body() dto: AddMembersDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    await this.management.addMembers(page, user, dto);
    this.audit(AuditEvent.PAGE_PERMISSION_ADDED, page, {
      userIds: dto.userIds ?? [],
      groupIds: dto.groupIds ?? [],
      role: dto.role,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update-role')
  async updateRole(
    @Body() dto: UpdateRoleDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    await this.management.updateRole(page, user, dto);
    this.audit(AuditEvent.PAGE_PERMISSION_ADDED, page, {
      userId: dto.userId,
      groupId: dto.groupId,
      role: dto.role,
      roleUpdate: true,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove-member')
  async removeMember(
    @Body() dto: MemberTargetDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const page = await this.requirePage(dto.pageId, workspace.id);
    await this.management.removeMember(page, user, dto);
    this.audit(AuditEvent.PAGE_PERMISSION_REMOVED, page, {
      userId: dto.userId,
      groupId: dto.groupId,
    });
  }
}
