import { BadRequestException } from '@nestjs/common';
import { MxdRelationService } from './mxd-relation.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

function make(opts: { single?: boolean; relationType?: string } = {}) {
  const relatedTable = { id: 'tRelated', workspaceId: 'ws1', spaceId: 's', pageId: 'p' };
  const srcTable = { id: 'tSrc', workspaceId: 'ws1', spaceId: 's', pageId: 'p' };
  const field = {
    id: 'fRel',
    tableId: 'tSrc',
    type: opts.relationType ?? 'relation',
    config: { relatedTableId: 'tRelated', single: opts.single },
  };
  const tableRepo = {
    findById: jest.fn().mockImplementation(async (_w, id) =>
      id === 'tSrc' ? srcTable : id === 'tRelated' ? relatedTable : undefined,
    ),
  };
  const fieldRepo = { findById: jest.fn().mockResolvedValue(field) };
  const recordRepo = {
    findById: jest.fn().mockImplementation(async (_w, tableId, recId) => {
      // records exist only in their proper table
      if (tableId === 'tSrc' && recId === 'from') return { id: 'from' };
      if (tableId === 'tRelated' && recId === 'to') return { id: 'to' };
      return undefined;
    }),
  };
  const linkRepo = {
    insert: jest.fn().mockResolvedValue({ id: 'e1' }),
    listFrom: jest.fn().mockResolvedValue([]),
    deleteEdge: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MxdRelationService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    linkRepo as any,
    access as any,
  );
  return { service, tableRepo, fieldRepo, recordRepo, linkRepo, access };
}

const edge = {
  tableId: 'tSrc',
  fieldId: 'fRel',
  fromRecordId: 'from',
  toRecordId: 'to',
};

describe('MxdRelationService', () => {
  it('links two records and authorizes source-write + target-read', async () => {
    const { service, linkRepo, access } = make();
    await service.link(ctx, edge);
    expect(linkRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        fieldId: 'fRel',
        fromRecordId: 'from',
        toRecordId: 'to',
      }),
    );
    expect(access.authorizeWrite).toHaveBeenCalled(); // source
    expect(access.authorizeRead).toHaveBeenCalled(); // target table
  });

  it('rejects a target record that is not in the related table (IDOR)', async () => {
    const { service } = make();
    await expect(
      service.link(ctx, { ...edge, toRecordId: 'someone-elses' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the field is not a relation', async () => {
    const { service } = make({ relationType: 'text' });
    await expect(service.link(ctx, edge)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('single (one-to-*) replaces the existing edge before inserting', async () => {
    const { service, linkRepo } = make({ single: true });
    linkRepo.listFrom.mockResolvedValue([
      { fromRecordId: 'from', toRecordId: 'old' },
    ]);
    await service.link(ctx, edge);
    expect(linkRepo.deleteEdge).toHaveBeenCalledWith('ws1', 'fRel', 'from', 'old');
    expect(linkRepo.insert).toHaveBeenCalled();
  });

  it('unlink deletes the edge (after source-write authz)', async () => {
    const { service, linkRepo, access } = make();
    await service.unlink(ctx, edge);
    expect(access.authorizeWrite).toHaveBeenCalled();
    expect(linkRepo.deleteEdge).toHaveBeenCalledWith('ws1', 'fRel', 'from', 'to');
  });
});
