import { NotFoundException } from '@nestjs/common';
import { MxdPublicDataService } from './mxd-public-data.service';

// Scope enforcement is the whole point of the public read path: a table is
// reachable only when its home page falls within the share's scope, public
// sharing is enabled, and the share is live. Each guard below must 404.

const table = {
  id: 't1',
  workspaceId: 'ws1',
  spaceId: 's1',
  pageId: 'p_table',
  title: 'T',
};

function make(over: any = {}) {
  const share =
    'share' in over
      ? over.share
      : {
          id: 'sh1',
          key: 'k1',
          workspaceId: 'ws1',
          spaceId: 's1',
          pageId: 'p_shared',
          includeSubPages: true,
          deletedAt: null,
        };
  const shareRepo = {
    findById: jest.fn().mockResolvedValue(share),
    isSharingAllowed: jest
      .fn()
      .mockResolvedValue('sharingAllowed' in over ? over.sharingAllowed : true),
    isPageWithinShareScope: jest
      .fn()
      .mockResolvedValue('withinScope' in over ? over.withinScope : true),
  };
  const tableRepo = {
    findById: jest
      .fn()
      .mockResolvedValue('table' in over ? over.table : table),
  };
  const fields = [
    { id: 'f_name', type: 'text', name: 'Name', config: {} },
    { id: 'f_score', type: 'number', name: 'Score', config: {} },
  ];
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const viewRepo = {
    listByTable: jest.fn().mockResolvedValue([{ id: 'v1', config: {} }]),
    findById: jest.fn().mockResolvedValue({ id: 'v1', config: {} }),
  };
  const recordRepo = {
    queryView: jest
      .fn()
      .mockResolvedValue({ items: [{ id: 'r1', data: {} }], total: 1, limit: 50, offset: 0 }),
  };
  const compute = {
    enrich: jest.fn().mockImplementation(async (_ctx, _fields, items) => items),
  };
  const service = new MxdPublicDataService(
    shareRepo as any,
    tableRepo as any,
    fieldRepo as any,
    viewRepo as any,
    recordRepo as any,
    compute as any,
  );
  return { service, shareRepo, tableRepo, fieldRepo, recordRepo, compute };
}

describe('MxdPublicDataService — resolve/authz', () => {
  it('returns the table when the share grants scope', async () => {
    const { service } = make();
    const t = await service.getTable('k1', 't1');
    expect(t.id).toBe('t1');
  });

  it('404s when the share key is unknown', async () => {
    const { service } = make({ share: null });
    await expect(service.getTable('nope', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the share is soft-deleted', async () => {
    const { service } = make({
      share: {
        id: 'sh1',
        key: 'k1',
        workspaceId: 'ws1',
        spaceId: 's1',
        pageId: 'p_shared',
        includeSubPages: true,
        deletedAt: new Date(),
      },
    });
    await expect(service.getTable('k1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when public sharing is disabled for the space', async () => {
    const { service } = make({ sharingAllowed: false });
    await expect(service.getTable('k1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the table page is outside the share scope', async () => {
    const { service } = make({ withinScope: false });
    await expect(service.getTable('k1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s when the table does not exist', async () => {
    const { service } = make({ table: null });
    await expect(service.getTable('k1', 't1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('queryRecords enriches with an anonymous (userId: null) context', async () => {
    const { service, compute } = make();
    const page = await service.queryRecords('k1', 't1', { viewId: 'v1' });
    expect(page.items).toHaveLength(1);
    const ctxArg = compute.enrich.mock.calls[0][0];
    expect(ctxArg).toEqual({ workspaceId: 'ws1', userId: null });
  });
});
