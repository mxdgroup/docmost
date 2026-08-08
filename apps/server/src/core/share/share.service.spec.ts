import { ForbiddenException } from '@nestjs/common';
import { ShareService } from './share.service';
import { ShareMode } from './share-mode';

// Direct construction: only the collaborators exercised by the methods under
// test are functional mocks; the rest are inert placeholders.
function buildService(opts: {
  shareEditEnabled?: boolean;
  guestCommentsEnabled?: boolean;
  existingShare?: unknown;
}) {
  const shareRepo = {
    findByPageId: jest.fn().mockResolvedValue(opts.existingShare ?? null),
    insertShare: jest.fn().mockImplementation(async (v) => v),
    updateShare: jest.fn().mockImplementation(async (v, _id) => v),
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
    {} as any, // pageRepo
    {} as any, // pagePermissionRepo
    {} as any, // db
    {} as any, // tokenService
    {} as any, // transclusionService
    environmentService as any,
  );
  return { service, shareRepo, environmentService };
}

const page = {
  id: '00000000-0000-0000-0000-000000000001',
  spaceId: '00000000-0000-0000-0000-000000000002',
} as any;
const workspaceId = '00000000-0000-0000-0000-000000000003';
const authUserId = '00000000-0000-0000-0000-000000000004';

describe('ShareService share mode', () => {
  it('creates a view share by default (no mode given)', async () => {
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

  it('rotateShareKey mints a new key and touches nothing else', async () => {
    const { service, shareRepo } = buildService({});
    await service.rotateShareKey('share-1');
    const patch = shareRepo.updateShare.mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(['key']);
    expect(typeof patch.key).toBe('string');
    expect(patch.key.length).toBeGreaterThan(6);
  });
});
