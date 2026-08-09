import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthenticationExtension } from './authentication.extension';
import { JwtType } from '../../core/auth/dto/jwt-payload';

// Direct construction; only collaborators used by the share branch are
// functional. The user-collab path is exercised via one regression case.
const WS = '00000000-0000-0000-0000-00000000000a';
const SHARE = '00000000-0000-0000-0000-00000000000b';
const PAGE = '00000000-0000-0000-0000-00000000000c';
const DOC = `page.${PAGE}`;

function build(opts: {
  flag?: boolean;
  share?: any;
  page?: any;
  inScope?: boolean;
  restricted?: boolean;
  tokenPayload?: any;
  collabPayload?: any;
  user?: any;
}) {
  const tokenService = {
    verifyJwt: jest.fn(async (_token: string, type: string) => {
      if (type === JwtType.COLLAB) {
        if (opts.collabPayload) return opts.collabPayload;
        throw new UnauthorizedException('wrong type');
      }
      if (type === JwtType.SHARE_COLLAB) {
        if (opts.tokenPayload) return opts.tokenPayload;
        throw new UnauthorizedException('wrong type');
      }
      throw new UnauthorizedException();
    }),
  };
  const userRepo = { findById: jest.fn().mockResolvedValue(opts.user ?? null) };
  const pageRepo = {
    findById: jest.fn().mockResolvedValue(
      'page' in opts ? opts.page : { id: PAGE, workspaceId: WS, deletedAt: null },
    ),
  };
  const spaceMemberRepo = { getUserSpaceRoles: jest.fn().mockResolvedValue([]) };
  const pagePermissionRepo = {
    hasRestrictedAncestor: jest.fn().mockResolvedValue(opts.restricted ?? false),
    canUserEditPage: jest.fn().mockResolvedValue({
      hasAnyRestriction: false,
      canAccess: true,
      canEdit: true,
    }),
  };
  const shareRepo = {
    findById: jest.fn().mockResolvedValue('share' in opts ? opts.share : null),
    isPageWithinShareScope: jest.fn().mockResolvedValue(opts.inScope ?? true),
    isSharingAllowed: jest.fn().mockResolvedValue(opts.sharingAllowed ?? true),
  };
  const environmentService = {
    isShareEditEnabled: jest.fn().mockReturnValue(opts.flag ?? true),
  };
  const ext = new AuthenticationExtension(
    tokenService as any,
    userRepo as any,
    pageRepo as any,
    spaceMemberRepo as any,
    pagePermissionRepo as any,
    shareRepo as any,
    environmentService as any,
  );
  return { ext, tokenService, shareRepo, pagePermissionRepo };
}

const validPayload = {
  shareId: SHARE,
  pageId: PAGE,
  workspaceId: WS,
  type: 'share_collab',
};
const editShare = {
  id: SHARE,
  pageId: PAGE,
  workspaceId: WS,
  mode: 'edit',
  includeSubPages: true,
  deletedAt: null,
};

function payloadFor(overrides: any = {}) {
  return {
    documentName: DOC,
    token: 'tok',
    connectionConfig: { readOnly: false },
    ...overrides,
  } as any;
}

describe('AuthenticationExtension share-collab branch', () => {
  it('happy path: edit share in scope → anonymous principal, not readOnly', async () => {
    const { ext } = build({ tokenPayload: validPayload, share: editShare });
    const data = payloadFor();
    const result = await ext.onAuthenticate(data);
    expect(result.user).toBeNull();
    expect((result as any).anonymousShare).toEqual({
      shareId: SHARE,
      pageId: PAGE,
    });
    expect(data.connectionConfig.readOnly).toBe(false);
  });

  it('rejects when the feature flag is off', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      flag: false,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when workspace/space sharing is disabled (kill switch on reconnect)', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      sharingAllowed: false,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('token-type confusion: token that is neither COLLAB nor SHARE_COLLAB is rejected', async () => {
    const { ext } = build({ share: editShare }); // verifyJwt throws for both types
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('replay against a different document is rejected (token.pageId != doc page)', async () => {
    const { ext, shareRepo } = build({
      tokenPayload: { ...validPayload, pageId: 'other-page' },
      share: editShare,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(shareRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects view- and comment-mode shares', async () => {
    for (const mode of ['view', 'comment', null]) {
      const { ext } = build({
        tokenPayload: validPayload,
        share: { ...editShare, mode },
      });
      await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('rejects deleted or missing shares (revocation cuts off on reconnect)', async () => {
    for (const share of [null, { ...editShare, deletedAt: new Date() }]) {
      const { ext } = build({ tokenPayload: validPayload, share });
      await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('rejects out-of-scope pages (share moved/narrowed after mint)', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      inScope: false,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects pages with page-level restrictions (defense in depth)', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      restricted: true,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects soft-deleted pages outright (no readonly fallback for anonymous)', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      page: { id: PAGE, workspaceId: WS, deletedAt: new Date() },
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects missing pages', async () => {
    const { ext } = build({
      tokenPayload: validPayload,
      share: editShare,
      page: null,
    });
    await expect(ext.onAuthenticate(payloadFor())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('regression: a valid user COLLAB token still authenticates the user path', async () => {
    const user = { id: 'u1', deactivatedAt: null, deletedAt: null };
    const { ext } = build({
      collabPayload: { sub: 'u1', workspaceId: WS, type: 'collab' },
      user,
      share: editShare,
    });
    // space role WRITER so the user path completes
    const spaceMemberRepo = (ext as any).spaceMemberRepo;
    spaceMemberRepo.getUserSpaceRoles.mockResolvedValue([{ role: 'writer' }]);
    const pageRepo = (ext as any).pageRepo;
    pageRepo.findById.mockResolvedValue({
      id: PAGE,
      spaceId: 's1',
      workspaceId: WS,
      deletedAt: null,
    });
    const result = await ext.onAuthenticate(payloadFor());
    expect(result.user).toEqual(user);
  });
});
