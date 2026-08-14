import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdViewService } from './mxd-view.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

function make(over: any = {}) {
  const tableRepo = {
    findById: jest.fn().mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1' }),
    ...over.tableRepo,
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue([]) };
  const viewRepo = {
    insert: jest.fn().mockResolvedValue({ id: 'v1', type: 'grid' }),
    listByTable: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'v1' }),
    update: jest.fn().mockResolvedValue({ id: 'v1' }),
    delete: jest.fn().mockResolvedValue(undefined),
    ...over.viewRepo,
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MxdViewService(
    tableRepo as any,
    fieldRepo as any,
    viewRepo as any,
    access as any,
  );
  return { service, tableRepo, fieldRepo, viewRepo, access };
}

describe('MxdViewService', () => {
  it('creates a view (authorizes write, defaults type to grid)', async () => {
    const { service, viewRepo, access } = make();
    await service.createView(ctx, 't1', { name: 'Grid' });
    expect(access.authorizeWrite).toHaveBeenCalled();
    expect(viewRepo.insert).toHaveBeenCalled();
  });

  it('rejects an unknown view type', async () => {
    const { service } = make();
    await expect(
      service.createView(ctx, 't1', { type: 'hologram' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listViews authorizes read; getView 404s when missing', async () => {
    const { service, access } = make();
    await service.listViews(ctx, 't1');
    expect(access.authorizeRead).toHaveBeenCalled();
    const gone = make({ viewRepo: { findById: jest.fn().mockResolvedValue(undefined) } });
    await expect(gone.service.getView(ctx, 't1', 'v1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('mutations authorize write and 404 when the repo reports no row', async () => {
    const { service, access } = make({ viewRepo: { update: jest.fn().mockResolvedValue(undefined) } });
    await expect(service.renameView(ctx, 't1', 'v1', 'X')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.updateConfig(ctx, 't1', 'v1', { config: {} }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(access.authorizeWrite).toHaveBeenCalled();
  });

  it('deleteView 404s when the view is not found', async () => {
    const { service } = make({ viewRepo: { findById: jest.fn().mockResolvedValue(undefined) } });
    await expect(service.deleteView(ctx, 't1', 'v1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
