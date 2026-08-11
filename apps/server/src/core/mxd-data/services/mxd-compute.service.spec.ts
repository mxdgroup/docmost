import { MxdComputeService } from './mxd-compute.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

// Fields: a relation (via) + a lookup + two rollups over the related "rev".
const via = {
  id: 'via',
  type: 'relation',
  config: { relatedTableId: 'tRel' },
} as any;
const lookup = {
  id: 'look',
  type: 'lookup',
  config: { viaFieldId: 'via', targetFieldId: 'name' },
} as any;
const rollupCount = {
  id: 'rc',
  type: 'rollup',
  config: { viaFieldId: 'via', targetFieldId: 'rev', rollup: 'count' },
} as any;
const rollupSum = {
  id: 'rs',
  type: 'rollup',
  config: { viaFieldId: 'via', targetFieldId: 'rev', rollup: 'sum' },
} as any;

function make() {
  const linkRepo = {
    listFromMany: jest.fn().mockResolvedValue([
      { fromRecordId: 'p1', toRecordId: 'c1' },
      { fromRecordId: 'p1', toRecordId: 'c2' },
    ]),
  };
  const recordRepo = {
    findByIds: jest.fn().mockResolvedValue([
      { id: 'c1', data: { name: 'Acme', rev: 10 } },
      { id: 'c2', data: { name: 'Globex', rev: 20 } },
    ]),
  };
  const tableRepo = {
    findById: jest.fn().mockResolvedValue({ id: 'tRel', pageId: 'p', spaceId: 's' }),
  };
  const access = { canRead: jest.fn().mockResolvedValue(true) };
  const service = new MxdComputeService(
    recordRepo as any,
    linkRepo as any,
    tableRepo as any,
    access as any,
  );
  return { service, linkRepo, recordRepo, tableRepo, access };
}

describe('MxdComputeService', () => {
  it('computes lookup (array of target values) and rollups (count/sum)', async () => {
    const { service } = make();
    const records = [{ id: 'p1', data: {} }] as any[];
    const [p1] = await service.enrich(
      ctx,
      [via, lookup, rollupCount, rollupSum],
      records,
    );
    const d = p1.data as any;
    expect(d.look).toEqual(['Acme', 'Globex']);
    expect(d.rc).toBe(2); // count of related
    expect(d.rs).toBe(30); // sum of rev
  });

  it('is a no-op when there are no computed fields', async () => {
    const { service, linkRepo } = make();
    const records = [{ id: 'p1', data: { x: 1 } }] as any[];
    const out = await service.enrich(ctx, [via], records);
    expect(out[0].data as any).toEqual({ x: 1 });
    expect(linkRepo.listFromMany).not.toHaveBeenCalled();
  });

  it('yields empty/null when the relation config is incomplete', async () => {
    const { service } = make();
    const badLookup = { id: 'bad', type: 'lookup', config: {} } as any;
    const [p1] = await service.enrich(ctx, [badLookup], [{ id: 'p1', data: {} }] as any);
    expect((p1.data as any).bad).toEqual([]);
  });

  it('computes formula fields in dependency order', async () => {
    const { service } = make();
    const fields = [
      { id: 'amount', type: 'number' },
      { id: 'qty', type: 'number' },
      { id: 'total', type: 'formula', config: { expression: '{amount} * {qty}' } },
      { id: 'withtax', type: 'formula', config: { expression: '{total} * 1.1' } },
    ] as any[];
    const [r] = await service.enrich(ctx, fields, [
      { id: 'r1', data: { amount: 10, qty: 2 } },
    ] as any);
    expect((r.data as any).total).toBe(20);
    expect((r.data as any).withtax).toBeCloseTo(22);
  });

  it('contains a circular formula as an error (never throws)', async () => {
    const { service } = make();
    const fields = [
      { id: 'fa', type: 'formula', config: { expression: '{fb} + 1' } },
      { id: 'fb', type: 'formula', config: { expression: '{fa} + 1' } },
    ] as any[];
    const [r] = await service.enrich(ctx, fields, [{ id: 'r1', data: {} }] as any);
    expect((r.data as any).fa).toEqual({ error: 'circular reference' });
    expect((r.data as any).fb).toEqual({ error: 'circular reference' });
  });

  it('contains a runtime formula error (div by zero) as an error', async () => {
    const { service } = make();
    const fields = [
      { id: 'f', type: 'formula', config: { expression: '1 / 0' } },
    ] as any[];
    const [r] = await service.enrich(ctx, fields, [{ id: 'r1', data: {} }] as any);
    expect((r.data as any).f).toHaveProperty('error');
  });
});
