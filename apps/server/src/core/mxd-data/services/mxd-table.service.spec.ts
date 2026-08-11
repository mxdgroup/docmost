import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MxdTableService } from './mxd-table.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

const fakeDb = { transaction: () => ({ execute: (cb: any) => cb({}) }) } as any;

function make(over: any = {}) {
  const tableRepo = {
    insert: jest.fn().mockResolvedValue({ id: 't1', spaceId: 's1' }),
    findById: jest.fn().mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1' }),
    update: jest.fn().mockResolvedValue({ id: 't1' }),
    listBySpace: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
    softDelete: jest.fn().mockResolvedValue(undefined),
    ...over.tableRepo,
  };
  const fieldRepo = { insert: jest.fn().mockResolvedValue({ id: 'f1' }) };
  const viewRepo = { insert: jest.fn().mockResolvedValue({ id: 'v1' }) };
  const pageRepo = {
    findById: jest.fn().mockResolvedValue({ id: 'p1', workspaceId: 'ws1', spaceId: 's1' }),
    ...over.pageRepo,
  };
  const access = {
    authorizePageWrite: jest.fn().mockResolvedValue(undefined),
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
    canRead: jest.fn().mockResolvedValue(true),
    ...over.access,
  };
  const service = new MxdTableService(
    fakeDb,
    tableRepo as any,
    fieldRepo as any,
    viewRepo as any,
    pageRepo as any,
    access as any,
  );
  return { service, tableRepo, fieldRepo, viewRepo, pageRepo, access };
}

describe('MxdTableService', () => {
  it('creates a table with a primary field + default view after authorizing page edit', async () => {
    const { service, tableRepo, fieldRepo, viewRepo, access } = make();
    await service.createTable(ctx, { pageId: 'p1', title: 'People' });
    expect(access.authorizePageWrite).toHaveBeenCalled();
    expect(tableRepo.insert).toHaveBeenCalled();
    expect(fieldRepo.insert).toHaveBeenCalled(); // primary
    expect(viewRepo.insert).toHaveBeenCalled(); // default grid
  });

  it('refuses to create a table on a page in another workspace (IDOR)', async () => {
    const { service } = make({
      pageRepo: { findById: jest.fn().mockResolvedValue({ id: 'p1', workspaceId: 'other', spaceId: 's' }) },
    });
    await expect(
      service.createTable(ctx, { pageId: 'p1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to create a table when the page is missing', async () => {
    const { service } = make({ pageRepo: { findById: jest.fn().mockResolvedValue(undefined) } });
    await expect(service.createTable(ctx, { pageId: 'nope' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('getTable authorizes read and 404s when missing', async () => {
    const { service, access } = make();
    await service.getTable(ctx, 't1');
    expect(access.authorizeRead).toHaveBeenCalled();
    const gone = make({ tableRepo: { findById: jest.fn().mockResolvedValue(undefined) } });
    await expect(gone.service.getTable(ctx, 't1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listTables filters out tables the caller cannot read', async () => {
    const { service, access } = make();
    access.canRead
      .mockResolvedValueOnce(true) // t1
      .mockResolvedValueOnce(false); // t2
    const out = await service.listTables(ctx, 's1');
    expect(out.map((t) => t.id)).toEqual(['t1']);
  });

  it('rename/archive authorize write and 404 when the table is gone', async () => {
    const { service, access } = make();
    await service.renameTable(ctx, 't1', 'New');
    await service.archiveTable(ctx, 't1');
    expect(access.authorizeWrite).toHaveBeenCalledTimes(2);
    const gone = make({ tableRepo: { findById: jest.fn().mockResolvedValue(undefined) } });
    await expect(gone.service.renameTable(ctx, 't1', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
