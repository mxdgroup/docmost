// MXD (plan Unit 8): AGPL management surface over the page-permission
// plumbing that already ships in core. Implemented from
// PAGE-PERMISSIONS-BEHAVIOR.md (clean-room — EE sources not consulted).
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Page, User } from '@docmost/db/types/entity.types';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { PageAccessLevel } from '../../../common/helpers/types/permission';
import { PageAccessService } from './page-access.service';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';

export enum PagePermissionRole {
  WRITER = 'writer',
  READER = 'reader',
}

@Injectable()
export class PageAccessManagementService {
  constructor(
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  // Behavior 8: space admins always manage; otherwise the actor must be a
  // writer-level member of the page's effective restriction.
  private async assertCanManage(page: Page, user: User): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      return;
    }
    const level = await this.pagePermissionRepo.getUserPageAccessLevel(
      user.id,
      page.id,
    );
    if (!level.hasAnyRestriction || !level.canEdit) {
      throw new ForbiddenException(
        'Only space admins or page editors can manage page permissions',
      );
    }
  }

  // Behavior 1: restrict; idempotent; seeds the actor as writer.
  // Returns { changed } so the caller only audits a real state change.
  async restrict(page: Page, user: User, workspaceId: string) {
    // Pre-restriction the page has no member list — actor needs page edit
    // rights under the CURRENT rules (space-level, or inherited restriction).
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.pagePermissionRepo.findPageAccessByPageId(
      page.id,
    );
    if (existing) return { pageAccess: existing, changed: false };

    // The access row and its seed writer are one atomic act: a failure between
    // them would strand a restricted page with zero members (locked out for
    // everyone but a space admin). Wrap both in a single transaction so the
    // ">=1 writer from birth" invariant can never be half-applied.
    const pageAccess = await executeTx(this.db, async (trx) => {
      const created = await this.pagePermissionRepo.insertPageAccess(
        {
          pageId: page.id,
          spaceId: page.spaceId,
          workspaceId,
          accessLevel: PageAccessLevel.RESTRICTED,
          creatorId: user.id,
        },
        trx,
      );
      await this.pagePermissionRepo.insertPagePermissions(
        [
          {
            pageAccessId: created.id,
            userId: user.id,
            role: PagePermissionRole.WRITER,
            addedById: user.id,
          },
        ],
        trx,
      );
      return created;
    });
    return { pageAccess, changed: true };
  }

  // Behavior 2: open; idempotent; members cascade with the access row.
  // Returns { changed } so the caller only audits a real state change.
  async open(page: Page, user: User) {
    const existing = await this.pagePermissionRepo.findPageAccessByPageId(
      page.id,
    );
    if (!existing) return { changed: false };
    await this.assertCanManage(page, user);
    await this.pagePermissionRepo.deletePageAccess(page.id);
    return { changed: true };
  }

  // Behavior 3: any user who can access the page may list members.
  async listMembers(page: Page, user: User, pagination: PaginationOptions) {
    await this.pageAccessService.validateCanView(page, user);
    const access = await this.requireAccessRow(page);
    return this.pagePermissionRepo.getPagePermissionsPaginated(
      access.id,
      pagination,
    );
  }

  // Behavior 4: add users/groups; duplicate adds become role updates.
  async addMembers(
    page: Page,
    user: User,
    dto: { userIds?: string[]; groupIds?: string[]; role: string },
  ) {
    await this.assertCanManage(page, user);
    const access = await this.requireAccessRow(page);
    const role = this.normalizeRole(dto.role);

    for (const userId of dto.userIds ?? []) {
      const existing = await this.pagePermissionRepo.findPagePermissionByUserId(
        access.id,
        userId,
      );
      if (existing) {
        await this.pagePermissionRepo.updatePagePermissionRole(
          access.id,
          role,
          { userId },
        );
      } else {
        await this.pagePermissionRepo.insertPagePermissions([
          { pageAccessId: access.id, userId, role, addedById: user.id },
        ]);
      }
    }
    for (const groupId of dto.groupIds ?? []) {
      const existing =
        await this.pagePermissionRepo.findPagePermissionByGroupId(
          access.id,
          groupId,
        );
      if (existing) {
        await this.pagePermissionRepo.updatePagePermissionRole(
          access.id,
          role,
          { groupId },
        );
      } else {
        await this.pagePermissionRepo.insertPagePermissions([
          { pageAccessId: access.id, groupId, role, addedById: user.id },
        ]);
      }
    }
  }

  // Behavior 5: role change; the last writer can never be demoted.
  async updateRole(
    page: Page,
    user: User,
    dto: { userId?: string; groupId?: string; role: string },
  ) {
    await this.assertCanManage(page, user);
    const access = await this.requireAccessRow(page);
    const role = this.normalizeRole(dto.role);
    this.assertExactlyOneTarget(dto);

    if (role === PagePermissionRole.READER) {
      await this.assertNotLastWriter(access.id, dto);
    }
    await this.pagePermissionRepo.updatePagePermissionRole(access.id, role, {
      userId: dto.userId,
      groupId: dto.groupId,
    });
  }

  // Behavior 6: removal; the last writer can never be removed. Self-removal
  // (walk-away) is allowed without manage rights — except for the last writer.
  async removeMember(
    page: Page,
    user: User,
    dto: { userId?: string; groupId?: string },
  ) {
    this.assertExactlyOneTarget(dto);
    const isSelfRemoval = dto.userId === user.id;
    if (!isSelfRemoval) {
      await this.assertCanManage(page, user);
    }
    const access = await this.requireAccessRow(page);
    await this.assertNotLastWriter(access.id, dto);

    if (dto.userId) {
      await this.pagePermissionRepo.deletePagePermissionByUserId(
        access.id,
        dto.userId,
      );
    } else {
      await this.pagePermissionRepo.deletePagePermissionByGroupId(
        access.id,
        dto.groupId,
      );
    }
  }

  private async requireAccessRow(page: Page) {
    const access = await this.pagePermissionRepo.findPageAccessByPageId(
      page.id,
    );
    if (!access) {
      throw new NotFoundException('Page is not restricted');
    }
    return access;
  }

  private normalizeRole(role: string): PagePermissionRole {
    if (
      role !== PagePermissionRole.WRITER &&
      role !== PagePermissionRole.READER
    ) {
      throw new BadRequestException('Invalid role');
    }
    return role;
  }

  private assertExactlyOneTarget(dto: { userId?: string; groupId?: string }) {
    if (Boolean(dto.userId) === Boolean(dto.groupId)) {
      throw new BadRequestException(
        'Provide exactly one of userId or groupId',
      );
    }
  }

  private async assertNotLastWriter(
    pageAccessId: string,
    target: { userId?: string; groupId?: string },
  ) {
    const existing = target.userId
      ? await this.pagePermissionRepo.findPagePermissionByUserId(
          pageAccessId,
          target.userId,
        )
      : await this.pagePermissionRepo.findPagePermissionByGroupId(
          pageAccessId,
          target.groupId,
        );
    if (!existing || existing.role !== PagePermissionRole.WRITER) {
      return; // not currently a writer — cannot be the last one
    }
    const writers =
      await this.pagePermissionRepo.countWritersByPageAccessId(pageAccessId);
    if (writers <= 1) {
      throw new BadRequestException(
        'A restricted page must keep at least one member who can edit',
      );
    }
  }
}
