jest.mock('../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class {},
}));
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShareService } from './share.service';
import { ShareMode } from './share-mode';

// Direct construction: only the collaborators exercised by the methods under
// test are functional mocks; the rest are inert placeholders.
function buildService(opts: {
  shareEditEnabled?: boolean;
  guestCommentsEnabled?: boolean;
  existingShare?: unknown;
  shareById?: unknown;
  pageById?: unknown;
  inScope?: boolean;
  restricted?: boolean;
  sharingAllowed?: boolean;
}) {
  const shareRepo = {
    findByPageId: jest.fn().mockResolvedValue(opts.existingShare ?? null),
    findById: jest.fn().mockResolvedValue(opts.shareById ?? null),
    insertShare: jest.fn().mockImplementation(async (v) => v),
    updateShare: jest.fn().mockImplementation(async (v, _id) => v),
    isPageWithinShareScope: jest.fn().mockResolvedValue(opts.inScope ?? true),
  };
  const pageRepo = {
    findById: jest.fn().mockResolvedValue(opts.pageById ?? null),
  };
  const pagePermissionRepo = {
    hasRestrictedAncestor: jest
      .fn()
      .mockResolvedValue(opts.restricted ?? false),
  };
  const tokenService = {
    generateShareCollabToken: jest.fn().mockResolvedValue('signed-token'),
  };
  const environmentService = {
    isShareEditEnabled: jest
      .fn()
      .mockReturnValue(opts.shareEditEnabled ?? false),
    isShareGuestCommentsEnabled: jest
      .fn()
      .mockReturnValue(opts.guestCommentsEnabled ?? false),
  };
  const service = new ShareService(
    shareRepo as any,
    pageRepo as any,
    pagePermissionRepo as any,
    {} as any, // db
    tokenService as any,
    {} as any, // transclusionService
    environmentService as any,
    { handleYjsEvent: jest.fn() } as any,
  );
  if (opts.sharingAllowed !== undefined || true) {
    jest
      .spyOn(service, 'isSharingAllowed')
      .mockResolvedValue(opts.sharingAllowed ?? true);
  }
  return { service, shareRepo, tokenService, environmentService };
}

const page = {
  id: '00000000-0000-0000-0000-000000000001',
  spaceId: '00000000-0000-0000-0000-000000000002',
} as any;
const workspaceId = '00000000-0000-0000-0000-000000000003';
const authUserId = '00000000-0000-0000-0000-000000000004';

describe('ShareService share mode', () => {
  it('creates a comment share by default when guest comments are on', async () => {
    const { service, shareRepo } = buildService({ guestCommentsEnabled: true });
    await service.createShare({
      authUserId,
      workspaceId,
      page,
      createShareDto: { pageId: page.id } as any,
    });
    expect(shareRepo.insertShare).toHaveBeenCalledWith(
      expect.objectContaining({ mode: ShareMode.COMMENT }),
    );
  });

  it('an explicit view mode is honored even when guest comments are on', async () => {
    const { service, shareRepo } = buildService({ guestCommentsEnabled: true });
    await service.createShare({
      authUserId,
      workspaceId,
      page,
      createShareDto: { pageId: page.id, mode: 'view' } as any,
    });
    expect(shareRepo.insertShare).toHaveBeenCalledWith(
      expect.objectContaining({ mode: ShareMode.VIEW }),
    );
  });

  it('creates a view share by default when guest comments are off', async () => {
    const { service, shareRepo } = buildService({});
    await service.createShare({
      authUserId,
      workspaceId,
      page,
      createShareDto: { pageId: page.id } as any,
    });
    expect(shareRepo.insertShare).toHaveBeenCalledWith(
      expect.objectContaining({ mode: ShareMode.VIEW }),
    );
  });

  it('rejects edit mode when the flag is off', async () => {
    const { service, shareRepo } = buildService({ shareEditEnabled: false });
    await expect(
      service.createShare({
        authUserId,
        workspaceId,
        page,
        createShareDto: { pageId: page.id, mode: 'edit' } as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(shareRepo.insertShare).not.toHaveBeenCalled();
  });

  it('rejects comment mode when guest comments are off', async () => {
    const { service } = buildService({ guestCommentsEnabled: false });
    await expect(
      service.createShare({
        authUserId,
        workspaceId,
        page,
        createShareDto: { pageId: page.id, mode: 'comment' } as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates an edit share when the flag is on', async () => {
    const { service, shareRepo } = buildService({ shareEditEnabled: true });
    await service.createShare({
      authUserId,
      workspaceId,
      page,
      createShareDto: { pageId: page.id, mode: 'edit' } as any,
    });
    expect(shareRepo.insertShare).toHaveBeenCalledWith(
      expect.objectContaining({ mode: ShareMode.EDIT }),
    );
  });

  it('update to edit is flag-gated; update without mode leaves mode untouched', async () => {
    const off = buildService({ shareEditEnabled: false });
    await expect(
      off.service.updateShare('share-1', { mode: 'edit' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const { service, shareRepo } = buildService({});
    await service.updateShare('share-1', {
      includeSubPages: true,
      searchIndexing: false,
    } as any);
    const patch = shareRepo.updateShare.mock.calls[0][0];
    expect(patch).not.toHaveProperty('mode');
  });
});

describe('ShareService.mintShareCollabToken', () => {
  const wsId = workspaceId;
  const editShare = {
    id: 'sh-1',
    pageId: page.id,
    spaceId: page.spaceId,
    workspaceId: wsId,
    mode: 'edit',
    includeSubPages: true,
    deletedAt: null,
  };
  const livePage = { id: page.id, workspaceId: wsId, deletedAt: null };

  it('mints a token for an edit share with the page in scope', async () => {
    const { service, tokenService } = buildService({
      shareEditEnabled: true,
      shareById: editShare,
      pageById: livePage,
    });
    const result = await service.mintShareCollabToken('sh-1', page.id, wsId);
    expect(result).toMatchObject({
      token: 'signed-token',
      readOnly: false,
      guest: { id: expect.any(String), name: expect.stringMatching(/^Guest /) },
    });
    expect(tokenService.generateShareCollabToken).toHaveBeenCalledWith({
      shareId: 'sh-1',
      pageId: page.id,
      workspaceId: wsId,
      guestId: result.guest.id,
    });
  });

  it('403 when the flag is off — even for a valid edit share', async () => {
    const { service, tokenService } = buildService({
      shareEditEnabled: false,
      shareById: editShare,
      pageById: livePage,
    });
    await expect(
      service.mintShareCollabToken('sh-1', page.id, wsId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokenService.generateShareCollabToken).not.toHaveBeenCalled();
  });

  it('403 for view shares; 404 for missing/deleted/foreign shares', async () => {
    for (const mode of ['view', null]) {
      const { service } = buildService({
        shareEditEnabled: true,
        guestCommentsEnabled: true,
        shareById: { ...editShare, mode },
        pageById: livePage,
      });
      await expect(
        service.mintShareCollabToken('sh-1', page.id, wsId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    for (const share of [
      null,
      { ...editShare, deletedAt: new Date() },
      { ...editShare, workspaceId: 'other-ws' },
    ]) {
      const { service } = buildService({
        shareEditEnabled: true,
        shareById: share,
        pageById: livePage,
      });
      await expect(
        service.mintShareCollabToken('sh-1', page.id, wsId),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });

  it('mints a read-only token for a comment share when guest comments are on', async () => {
    const { service, tokenService } = buildService({
      guestCommentsEnabled: true,
      shareById: { ...editShare, mode: 'comment' },
      pageById: livePage,
    });
    const result = await service.mintShareCollabToken('sh-1', page.id, wsId);
    expect(result).toMatchObject({ token: 'signed-token', readOnly: true });
    expect(tokenService.generateShareCollabToken).toHaveBeenCalled();
  });

  it('403 for a comment share when guest comments are off', async () => {
    const { service, tokenService } = buildService({
      shareEditEnabled: true,
      guestCommentsEnabled: false,
      shareById: { ...editShare, mode: 'comment' },
      pageById: livePage,
    });
    await expect(
      service.mintShareCollabToken('sh-1', page.id, wsId),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tokenService.generateShareCollabToken).not.toHaveBeenCalled();
  });

  it('403 when the page is outside the share scope or restricted', async () => {
    const outOfScope = buildService({
      shareEditEnabled: true,
      shareById: editShare,
      pageById: livePage,
      inScope: false,
    });
    await expect(
      outOfScope.service.mintShareCollabToken('sh-1', page.id, wsId),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const restricted = buildService({
      shareEditEnabled: true,
      shareById: editShare,
      pageById: livePage,
      restricted: true,
    });
    await expect(
      restricted.service.mintShareCollabToken('sh-1', page.id, wsId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 for deleted or missing pages', async () => {
    for (const p of [null, { ...livePage, deletedAt: new Date() }]) {
      const { service } = buildService({
        shareEditEnabled: true,
        shareById: editShare,
        pageById: p,
      });
      await expect(
        service.mintShareCollabToken('sh-1', page.id, wsId),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});

describe('Explicit public share capability', () => {
  it('uses the requested share, never another share discovered from the page id', async () => {
    const { service, shareRepo } = buildService({
      shareById: { id: 'requested', workspaceId, mode: 'view' },
      pageById: { ...page, workspaceId },
    });
    jest
      .spyOn(service, 'getShareForPage')
      .mockRejectedValue(new Error('must not discover another share'));
    jest
      .spyOn(service, 'updatePublicAttachments')
      .mockResolvedValue({ type: 'doc' });
    const result = await service.getSharedPage(
      { shareId: 'requested', pageId: page.id },
      workspaceId,
    );
    expect(result.share.mode).toBe('view');
    expect(shareRepo.isPageWithinShareScope).toHaveBeenCalledWith(
      result.share,
      page.id,
    );
  });

  it('rejects a valid page outside the requested share', async () => {
    const { service } = buildService({
      shareById: { id: 'requested', workspaceId, mode: 'edit' },
      pageById: { ...page, workspaceId },
      inScope: false,
    });
    await expect(
      service.getSharedPage(
        { shareId: 'requested', pageId: page.id },
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects attachment mutations using a comment link', async () => {
    const { service } = buildService({
      guestCommentsEnabled: true,
      shareById: { id: 'requested', workspaceId, mode: 'comment' },
      pageById: { ...page, workspaceId },
    });
    await expect(
      service.validateGuestEditAccess('requested', page.id, workspaceId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Public link revocation cannot be bypassed by page discovery', () => {
  it('requires a share capability, even when the caller knows the public page id', async () => {
    const { service, shareRepo } = buildService({
      pageById: { ...page, workspaceId },
    });
    await expect(
      service.getSharedPage({ pageId: page.id }, workspaceId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shareRepo.findById).not.toHaveBeenCalled();
  });
});
