import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdCsvService } from './mxd-csv.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name' },
  { id: 'f_age', type: 'number', name: 'Age' },
  { id: 'f_done', type: 'checkbox', name: 'Done' },
  { id: 'f_calc', type: 'formula', name: 'Calc' }, // computed -> not importable
];

function make(over: any = {}) {
  const tableRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        'table' in over ? over.table : { id: 't1', title: 'My Table' },
      ),
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const recordRepo = {
    list: jest.fn().mockResolvedValue({ items: over.items ?? [], total: 0 }),
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const compute = {
    enrich: jest.fn().mockImplementation(async (_c, _f, recs) => recs),
  };
  const recordService = {
    createRecord: jest.fn().mockResolvedValue({ id: 'r' }),
  };
  const service = new MxdCsvService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
    compute as any,
    recordService as any,
  );
  return { service, tableRepo, recordRepo, access, recordService };
}

describe('MxdCsvService — export', () => {
  it('authorizes read and renders a header + one row per record', async () => {
    const { service, access } = make({
      items: [
        { id: 'r1', data: { f_name: 'Alice', f_age: 30, f_done: true, f_calc: 60 } },
      ],
    });
    const res = await service.exportCsv(ctx, 't1');
    expect(access.authorizeRead).toHaveBeenCalled();
    expect(res.filename).toBe('My_Table.csv');
    expect(res.rowCount).toBe(1);
    const [header, row] = res.csv.trim().split('\n');
    expect(header).toBe('Name,Age,Done,Calc');
    expect(row).toBe('Alice,30,true,60');
  });
});

describe('MxdCsvService — import', () => {
  it('authorizes write, maps columns by name, coerces, and creates rows', async () => {
    const { service, access, recordService } = make();
    const csv = 'Name,Age,Done\nAlice,30,true\nBob,25,no';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(access.authorizeWrite).toHaveBeenCalled();
    expect(res.created).toBe(2);
    expect(recordService.createRecord).toHaveBeenNthCalledWith(1, ctx, 't1', {
      f_name: 'Alice',
      f_age: '30',
      f_done: true,
    });
    // "no" -> false via checkbox coercion
    expect(recordService.createRecord.mock.calls[1][2].f_done).toBe(false);
  });

  it('reports unknown and computed columns as unmapped, still imports the rest', async () => {
    const { service, recordService } = make();
    const csv = 'Name,Calc,Bogus\nAlice,999,x';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.unmappedColumns.sort()).toEqual(['Bogus', 'Calc']);
    // only Name mapped
    expect(recordService.createRecord).toHaveBeenCalledWith(ctx, 't1', {
      f_name: 'Alice',
    });
  });

  it('collects per-row validation errors without aborting the whole import', async () => {
    const { service, recordService } = make();
    recordService.createRecord
      .mockResolvedValueOnce({ id: 'r1' })
      .mockRejectedValueOnce(new Error('Age expects a number'));
    const csv = 'Name,Age\nAlice,30\nBob,notanumber';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.created).toBe(1);
    expect(res.errors).toEqual([{ row: 3, message: 'Age expects a number' }]);
  });

  it('skips fully-blank lines', async () => {
    const { service, recordService } = make();
    const csv = 'Name,Age\nAlice,30\n,\nBob,25';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.created).toBe(2);
    expect(recordService.createRecord).toHaveBeenCalledTimes(2);
  });

  it('rejects when no column maps to an importable field', async () => {
    const { service } = make();
    await expect(
      service.importCsv(ctx, 't1', 'Calc,Bogus\n1,2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s for a missing table', async () => {
    const { service } = make({ table: undefined });
    await expect(service.importCsv(ctx, 't1', 'Name\nAlice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
