import { MxdActionRunner } from './mxd-action-runner.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name' },
  { id: 'f_due', type: 'date', name: 'Due' },
  { id: 'f_at', type: 'datetime', name: 'At' },
];

function make(over: any = {}) {
  const recordRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        'record' in over ? over.record : { id: 'r1', version: 3, data: { f_name: 'old' } },
      ),
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const recordService = {
    updateRecord: jest.fn().mockResolvedValue({ id: 'r1', version: 4 }),
    createRecord: jest.fn().mockResolvedValue({ id: 'r2' }),
  };
  const runner = new MxdActionRunner(
    fieldRepo as any,
    recordRepo as any,
    recordService as any,
  );
  return { runner, recordRepo, fieldRepo, recordService };
}

describe('MxdActionRunner', () => {
  it('applies setField/setNow in one version-checked update and runs createRecord', async () => {
    const { runner, recordService } = make();
    const res = await runner.run(
      ctx,
      't1',
      'r1',
      [
        { type: 'setField', fieldId: 'f_name', value: 'x' } as any,
        { type: 'setNow', fieldId: 'f_due' } as any,
        { type: 'setNow', fieldId: 'f_at' } as any,
        { type: 'createRecord', cells: { f_name: 'new' } } as any,
        { type: 'openUrl', url: 'https://example.com' } as any,
      ],
      { allowOpenUrl: true },
    );
    const upd = recordService.updateRecord.mock.calls[0];
    expect(upd[3]).toBe(3); // version
    expect(upd[4].f_name).toBe('x');
    expect(upd[4].f_due).toMatch(/^\d{4}-\d{2}-\d{2}$/); // date-only for a date field
    expect(upd[4].f_at).toContain('T'); // full ISO for datetime
    expect(recordService.createRecord).toHaveBeenCalledWith(ctx, 't1', {
      f_name: 'new',
    });
    expect(res.directives).toEqual([
      { type: 'openUrl', url: 'https://example.com' },
    ]);
  });

  it('suppresses openUrl directives when not allowed (automation path)', async () => {
    const { runner } = make();
    const res = await runner.run(
      ctx,
      't1',
      'r1',
      [{ type: 'openUrl', url: 'https://example.com' } as any],
      { allowOpenUrl: false },
    );
    expect(res.directives).toEqual([]);
  });

  it('skips a no-op setField so it produces no write (self-loop prevention)', async () => {
    const { runner, recordService } = make();
    // record already has f_name === 'old'
    await runner.run(
      ctx,
      't1',
      'r1',
      [{ type: 'setField', fieldId: 'f_name', value: 'old' } as any],
      {},
    );
    expect(recordService.updateRecord).not.toHaveBeenCalled();
  });

  it('is a no-op when the record is missing', async () => {
    const { runner, recordService } = make({ record: undefined });
    const res = await runner.run(
      ctx,
      't1',
      'gone',
      [{ type: 'setField', fieldId: 'f_name', value: 'x' } as any],
      {},
    );
    expect(res.directives).toEqual([]);
    expect(recordService.updateRecord).not.toHaveBeenCalled();
  });
});
