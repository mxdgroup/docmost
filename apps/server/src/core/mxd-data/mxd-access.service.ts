import { ForbiddenException, Injectable } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { MxdTable, Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../page/page-access/page-access.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { MxdContext } from './mxd-context';

// MXD data platform — centralized authorization (roadmap §2/§3/§4). A table is
// homed on a page, so table/record access follows that PAGE's access (space role
// + page-level restriction) via the SAME primitives Docmost pages use — not a
// parallel auth system, and NOT "record.workspaceId === caller.workspaceId".
//
// Read  → the caller can VIEW the table's page.
// Write → the caller can EDIT the table's page (records + schema + views).
// A table whose home page was deleted (pageId null) falls back to space-level
// ability so an orphaned table can't become a workspace-wide backdoor.
@Injectable()
export class MxdAccessService {
  constructor(
    private readonly pageAccessService: PageAccessService,
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  private requireUser(ctx: MxdContext): User {
    if (!ctx.user) {
      // The authenticated data-platform surface requires a real user. Public
      // share access is authorized on its own (separate) path.
      throw new ForbiddenException('Authentication required');
    }
    return ctx.user;
  }

  async authorizeRead(ctx: MxdContext, table: MxdTable): Promise<void> {
    const user = this.requireUser(ctx);
    const page = table.pageId
      ? await this.pageRepo.findById(table.pageId)
      : null;
    if (page) {
      await this.pageAccessService.validateCanView(page as Page, user);
    } else {
      await this.assertSpace(user, table.spaceId, SpaceCaslAction.Read);
    }
  }

  // Non-throwing read check — used to FILTER list results to the tables the
  // caller may actually see (so a restricted page's table isn't leaked in a
  // space listing).
  async canRead(ctx: MxdContext, table: MxdTable): Promise<boolean> {
    try {
      await this.authorizeRead(ctx, table);
      return true;
    } catch {
      return false;
    }
  }

  async authorizeWrite(ctx: MxdContext, table: MxdTable): Promise<void> {
    const user = this.requireUser(ctx);
    const page = table.pageId
      ? await this.pageRepo.findById(table.pageId)
      : null;
    if (page) {
      await this.pageAccessService.validateCanEdit(page as Page, user);
    } else {
      await this.assertSpace(user, table.spaceId, SpaceCaslAction.Edit);
    }
  }

  // For table creation, before the table exists: authorize edit on the target
  // page the table will be homed on.
  async authorizePageWrite(ctx: MxdContext, page: Page): Promise<void> {
    const user = this.requireUser(ctx);
    await this.pageAccessService.validateCanEdit(page, user);
  }

  private async assertSpace(
    user: User,
    spaceId: string,
    action: SpaceCaslAction,
  ): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(action, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
  }
}
