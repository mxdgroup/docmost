import { Extension, onAuthenticatePayload } from '@hocuspocus/server';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../core/auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../common/helpers/types/permission';
import { isUserDisabled } from '../../common/helpers';
import { getPageId } from '../collaboration.util';
import {
  JwtCollabPayload,
  JwtShareCollabPayload,
  JwtType,
} from '../../core/auth/dto/jwt-payload';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import {
  ShareMode,
  normalizeShareMode,
} from '../../core/share/share-mode';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);

  constructor(
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly shareRepo: ShareRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  async onAuthenticate(data: onAuthenticatePayload) {
    const { documentName, token } = data;
    const pageId = getPageId(documentName);

    let jwtPayload: JwtCollabPayload;

    try {
      jwtPayload = await this.tokenService.verifyJwt(token, JwtType.COLLAB);
    } catch (error) {
      // MXD: not a user collab token — try the anonymous share branch. The
      // branch is only entered for tokens whose type claim is SHARE_COLLAB;
      // everything about the share is re-validated server-side here, not
      // trusted from mint time.
      return this.authenticateShareCollab(data, pageId);
    }

    const userId = jwtPayload.sub;
    const workspaceId = jwtPayload.workspaceId;

    const user = await this.userRepo.findById(userId, workspaceId);

    if (!user) {
      throw new UnauthorizedException();
    }

    if (isUserDisabled(user)) {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page) {
      this.logger.debug(`Page not found: ${pageId}`);
      throw new NotFoundException('Page not found');
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      page.spaceId,
    );

    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    if (!userSpaceRole) {
      this.logger.warn(`User not authorized to access page: ${pageId}`);
      throw new UnauthorizedException();
    }

    // Check page-level permissions
    const { hasAnyRestriction, canAccess, canEdit } =
      await this.pagePermissionRepo.canUserEditPage(user.id, page.id);

    if (hasAnyRestriction) {
      if (!canAccess) {
        this.logger.warn(
          `User ${user.id} denied page-level access to page: ${pageId}`,
        );
        throw new UnauthorizedException();
      }

      if (!canEdit) {
        data.connectionConfig.readOnly = true;
        this.logger.debug(
          `User ${user.id} granted readonly access to restricted page: ${pageId}`,
        );
      }
    } else {
      // No restrictions - use space-level permissions
      if (userSpaceRole === SpaceRole.READER) {
        data.connectionConfig.readOnly = true;
        this.logger.debug(`User granted readonly access to page: ${pageId}`);
      }
    }

    if (page.deletedAt) {
      data.connectionConfig.readOnly = true;
    }

    this.logger.debug(`Authenticated user ${user.id} on page ${pageId}`);

    return {
      user,
    };
  }

  // MXD: anonymous share-scoped session. No user is ever attached to the
  // connection context; the persistence layer treats a missing user as
  // "preserve existing attribution".
  private async authenticateShareCollab(
    data: onAuthenticatePayload,
    pageId: string,
  ) {
    const { token } = data;

    let payload: JwtShareCollabPayload;
    try {
      payload = await this.tokenService.verifyJwt(
        token,
        JwtType.SHARE_COLLAB,
      );
    } catch {
      throw new UnauthorizedException('Invalid collab token');
    }

    if (!this.environmentService.isShareEditEnabled()) {
      throw new UnauthorizedException('Editable public links are disabled');
    }

    // The token is scoped to one page at mint time; the ws document must be
    // that page. This blocks replay of a token against sibling documents.
    if (payload.pageId !== pageId) {
      this.logger.warn(
        `Share collab token page mismatch: token=${payload.pageId} doc=${pageId}`,
      );
      throw new UnauthorizedException();
    }

    const share = await this.shareRepo.findById(payload.shareId);
    if (
      !share ||
      share.deletedAt ||
      share.workspaceId !== payload.workspaceId ||
      normalizeShareMode(share.mode) !== ShareMode.EDIT
    ) {
      // Revoked, downgraded, or rotated shares cut off editors here on the
      // next (re)connect — acceptable staleness = token TTL (10m).
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== share.workspaceId) {
      throw new NotFoundException('Page not found');
    }
    if (page.deletedAt) {
      throw new UnauthorizedException();
    }

    // Same authoritative scope check the mint endpoint used — re-run, not
    // trusted from the token (the share's pageId/includeSubPages may have
    // changed since mint).
    const inScope = await this.shareRepo.isPageWithinShareScope(share, pageId);
    if (!inScope) {
      this.logger.warn(
        `Share collab scope escape blocked: share=${share.id} page=${pageId}`,
      );
      throw new UnauthorizedException();
    }

    // Defense in depth: restricted pages are never editable anonymously,
    // even inside a shared subtree.
    const restricted =
      await this.pagePermissionRepo.hasRestrictedAncestor(pageId);
    if (restricted) {
      throw new UnauthorizedException();
    }

    this.logger.debug(
      `Anonymous share editor authenticated: share=${share.id} page=${pageId}`,
    );

    return {
      user: null,
      anonymousShare: { shareId: share.id, pageId },
    };
  }
}
