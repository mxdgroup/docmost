import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PageAccessManagementService } from './page-access-management.service';

const page = {
  id: 'p1',
  spaceId: 's1',
  workspaceId: 'w1',
} as any;
const admin = { id: 'admin' } as any;
const member = { id: 'member' } as any;

function build(opts: {
  isSpaceAdmin?: boolean;
  accessRow?: any;
  actorLevel?: Partial<{
    hasAnyRestriction: boolean;
    canEdit: boolean;
    canAccess: boolean;
  }>;
  writers?: number;
  existingUserPerm?: any;
  existingGroupPerm?: any;
}) {
  const repo = {
    findPageAccessByPageId: jest.fn().mockResolvedValue(
      'accessRow' in opts ? opts.accessRow : { id: 'pa1' },
    ),
    insertPageAccess: jest.fn().mockImplementation(async (v) => ({
      id: 'pa-new',
      ...v,
    })),
    insertPagePermissions: jest.fn(),
    deletePageAccess: jest.fn(),
    findPagePermissionByUserId: jest
      .fn()
      .mockResolvedValue(opts.existingUserPerm ?? null),
    findPagePermissionByGroupId: jest
      .fn()
      .mockResolvedValue(opts.existingGroupPerm ?? null),
    updatePagePermissionRole: jest.fn(),
    deletePagePermissionByUserId: jest.fn(),
    deletePagePermissionByGroupId: jest.fn(),
    countWritersByPageAccessId: jest.fn().mockResolvedValue(opts.writers ?? 2),
    getPagePermissionsPaginated: jest.fn().mockResolvedValue({ items: [] }),
    getUserPageAccessLevel: jest.fn().mockResolvedValue({
      hasAnyRestriction: true,
      canEdit: false,
      canAccess: true,
      ...opts.actorLevel,
    }),
  };
  const spaceAbility = {
    createForUser: jest.fn().mockResolvedValue({
      can: () => opts.isSpaceAdmin ?? false,
      cannot: () => !(opts.isSpaceAdmin ?? false),
    }),
  };
  const pageAccessService = {
    validateCanEdit: jest.fn().mockResolvedValue(undefined),
    validateCanView: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PageAccessManagementService(
    repo as any,
    spaceAbility as any,
    pageAccessService as any,
  );
  return { service, repo, pageAccessService };
}

describe('PageAccessManagementService', () => {
  it('restrict seeds the actor as writer; idempotent on re-restrict', async () => {
    const fresh = build({ accessRow: null });
    await fresh.service.restrict(page, admin, 'w1');
    expect(fresh.repo.insertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({ accessLevel: 'restricted', creatorId: 'admin' }),
    );
    expect(fresh.repo.insertPagePermissions).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'admin', role: 'writer' }),
    ]);

    const again = build({ accessRow: { id: 'pa1' } });
    const result = await again.service.restrict(page, admin, 'w1');
    expect(result).toEqual({ id: 'pa1' });
    expect(again.repo.insertPageAccess).not.toHaveBeenCalled();
  });

  it('open requires manage rights; idempotent when not restricted', async () => {
    const notManager = build({
      accessRow: { id: 'pa1' },
      actorLevel: { canEdit: false },
    });
    await expect(notManager.service.open(page, member)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const asAdmin = build({ accessRow: { id: 'pa1' }, isSpaceAdmin: true });
    await asAdmin.service.open(page, admin);
    expect(asAdmin.repo.deletePageAccess).toHaveBeenCalledWith('p1');

    const notRestricted = build({ accessRow: null });
    await notRestricted.service.open(page, admin); // no throw
    expect(notRestricted.repo.deletePageAccess).not.toHaveBeenCalled();
  });

  it('page writer (non-admin) can manage; non-writer cannot', async () => {
    const writer = build({
      actorLevel: { hasAnyRestriction: true, canEdit: true },
    });
    await writer.service.addMembers(page, member, {
      userIds: ['u2'],
      role: 'reader',
    });
    expect(writer.repo.insertPagePermissions).toHaveBeenCalled();

    const reader = build({
      actorLevel: { hasAnyRestriction: true, canEdit: false },
    });
    await expect(
      reader.service.addMembers(page, member, { userIds: ['u2'], role: 'reader' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('duplicate add becomes a role update (users and groups)', async () => {
    const b = build({
      isSpaceAdmin: true,
      existingUserPerm: { id: 'x', role: 'reader' },
      existingGroupPerm: { id: 'y', role: 'reader' },
    });
    await b.service.addMembers(page, admin, {
      userIds: ['u2'],
      groupIds: ['g1'],
      role: 'writer',
    });
    expect(b.repo.insertPagePermissions).not.toHaveBeenCalled();
    expect(b.repo.updatePagePermissionRole).toHaveBeenCalledTimes(2);
  });

  it('last writer cannot be demoted or removed', async () => {
    const demote = build({
      isSpaceAdmin: true,
      writers: 1,
      existingUserPerm: { id: 'x', role: 'writer' },
    });
    await expect(
      demote.service.updateRole(page, admin, { userId: 'u1', role: 'reader' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      demote.service.removeMember(page, admin, { userId: 'u1' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const okDemote = build({
      isSpaceAdmin: true,
      writers: 2,
      existingUserPerm: { id: 'x', role: 'writer' },
    });
    await okDemote.service.updateRole(page, admin, {
      userId: 'u1',
      role: 'reader',
    });
    expect(okDemote.repo.updatePagePermissionRole).toHaveBeenCalled();
  });

  it('self-removal (walk-away) works without manage rights, except last writer', async () => {
    const walker = build({
      actorLevel: { canEdit: false },
      writers: 2,
      existingUserPerm: { id: 'x', role: 'reader' },
    });
    await walker.service.removeMember(page, member, { userId: member.id });
    expect(walker.repo.deletePagePermissionByUserId).toHaveBeenCalled();
  });

  it('rejects zero-or-both member targets and invalid roles', async () => {
    const b = build({ isSpaceAdmin: true });
    await expect(
      b.service.updateRole(page, admin, { role: 'writer' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      b.service.updateRole(page, admin, {
        userId: 'u',
        groupId: 'g',
        role: 'writer',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      b.service.updateRole(page, admin, { userId: 'u', role: 'owner' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('member ops on an unrestricted page 404', async () => {
    const b = build({ isSpaceAdmin: true, accessRow: null });
    await expect(
      b.service.addMembers(page, admin, { userIds: ['u'], role: 'reader' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
