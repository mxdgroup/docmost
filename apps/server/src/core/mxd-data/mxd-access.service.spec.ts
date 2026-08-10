import { ForbiddenException } from '@nestjs/common';
import { MxdAccessService } from './mxd-access.service';
import { MxdContext } from './mxd-context';

const ctx = (over: Partial<MxdContext> = {}): MxdContext => ({
  workspaceId: 'w1',
  userId: 'u1',
  user: { id: 'u1' } as any,
  ...over,
});
const tableWithPage = { id: 't1', workspaceId: 'w1', spaceId: 's1', pageId: 'p1' } as any;
const tableNoPage = { id: 't2', workspaceId: 'w1', spaceId: 's1', pageId: null } as any;

function make(opts: { canView?: boolean; canEdit?: boolean; spaceCannot?: boolean } = {}) {
  const pageAccessService = {
    validateCanView: jest.fn().mockImplementation(async () => {
      if (opts.canView === false) throw new ForbiddenException();
    }),
    validateCanEdit: jest.fn().mockImplementation(async () => {
      if (opts.canEdit === false) throw new ForbiddenException();
      return { hasRestriction: false };
    }),
  };
  const pageRepo = { findById: jest.fn().mockResolvedValue({ id: 'p1', spaceId: 's1' }) };
  const ability = { cannot: jest.fn().mockReturnValue(!!opts.spaceCannot), can: jest.fn() };
  const spaceAbility = { createForUser: jest.fn().mockResolvedValue(ability) };
  const service = new MxdAccessService(
    pageAccessService as any,
    pageRepo as any,
    spaceAbility as any,
  );
  return { service, pageAccessService, pageRepo, spaceAbility };
}

describe('MxdAccessService', () => {
  it('read authorizes against the table page (validateCanView)', async () => {
    const { service, pageAccessService } = make({ canView: true });
    await service.authorizeRead(ctx(), tableWithPage);
    expect(pageAccessService.validateCanView).toHaveBeenCalled();
  });

  it('read is refused when the page view check fails', async () => {
    const { service } = make({ canView: false });
    await expect(service.authorizeRead(ctx(), tableWithPage)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('write authorizes against the table page (validateCanEdit)', async () => {
    const { service, pageAccessService } = make({ canEdit: true });
    await service.authorizeWrite(ctx(), tableWithPage);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalled();
  });

  it('write is refused when the page edit check fails', async () => {
    const { service } = make({ canEdit: false });
    await expect(service.authorizeWrite(ctx(), tableWithPage)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('falls back to space ability for an orphaned (page-less) table', async () => {
    const denied = make({ spaceCannot: true });
    await expect(denied.service.authorizeRead(ctx(), tableNoPage)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const allowed = make({ spaceCannot: false });
    await expect(allowed.service.authorizeRead(ctx(), tableNoPage)).resolves.toBeUndefined();
  });

  it('refuses when there is no authenticated user (public path is separate)', async () => {
    const { service } = make({ canView: true });
    await expect(
      service.authorizeRead(ctx({ user: null }), tableWithPage),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('canRead reflects authorizeRead without throwing', async () => {
    expect(await make({ canView: true }).service.canRead(ctx(), tableWithPage)).toBe(true);
    expect(await make({ canView: false }).service.canRead(ctx(), tableWithPage)).toBe(false);
  });
});
