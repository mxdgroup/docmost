import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdCsvService } from './mxd-csv.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name', config: {} },
  { id: 'f_age', type: 'number', name: 'Age', config: {} },
  { id: 'f_done', type: 'checkbox', name: 'Done', config: {} },
  { id: 'f_calc', type: 'formula', name: 'Calc', config: {} }, // computed -> not importable
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
    maxPosition: jest.fn().mockResolvedValue(over.maxPosition ?? 0),
    insertMany: jest
      .fn()
      .mockImplementation(async (rows: any[]) =>
        rows.map((r, i) => ({ id: `r${i + 1}`, ...r })),
      ),
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const compute = {
    enrich: jest.fn().mockImplementation(async (_c, _f, recs) => recs),
  };
  const service = new MxdCsvService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
    compute as any,
  );
  return { service, tableRepo, recordRepo, access };
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
  it('authorizes write once, maps columns by name, normalizes, and bulk-inserts via insertMany once', async () => {
    const { service, access, recordRepo } = make();
    const csv = 'Name,Age,Done\nAlice,30,true\nBob,25,no';
    const res = await service.importCsv(ctx, 't1', csv);

    expect(access.authorizeWrite).toHaveBeenCalledTimes(1);
    expect(recordRepo.maxPosition).toHaveBeenCalledTimes(1);
    expect(recordRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(res.created).toBe(2);

    const insertedRows = recordRepo.insertMany.mock.calls[0][0];
    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0]).toMatchObject({
      tableId: 't1',
      workspaceId: 'ws1',
      data: { f_name: 'Alice', f_age: 30, f_done: true },
      position: 1,
      version: 1,
      creatorId: 'u1',
      updatedById: 'u1',
    });
    // "no" -> false via checkbox coercion, and positions increment in memory.
    expect(insertedRows[1].data.f_done).toBe(false);
    expect(insertedRows[1].position).toBe(2);
  });

  it('reports unknown and computed columns as unmapped, still imports the rest', async () => {
    const { service, recordRepo } = make();
    const csv = 'Name,Calc,Bogus\nAlice,999,x';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.unmappedColumns.sort()).toEqual(['Bogus', 'Calc']);
    // only Name mapped
    const insertedRows = recordRepo.insertMany.mock.calls[0][0];
    expect(insertedRows[0].data).toEqual({ f_name: 'Alice' });
  });

  it('collects per-row validation errors with row numbers, and still imports the valid rows', async () => {
    const { service, recordRepo } = make();
    const csv = 'Name,Age\nAlice,30\nBob,notanumber';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.created).toBe(1);
    expect(res.errors).toEqual([
      { row: 3, message: 'Age: number expects a number' },
    ]);
    // The bad row must not abort the import — the valid row still inserts.
    const insertedRows = recordRepo.insertMany.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].data).toEqual({ f_name: 'Alice', f_age: 30 });
  });

  it('skips fully-blank lines', async () => {
    const { service, recordRepo } = make();
    const csv = 'Name,Age\nAlice,30\n,\nBob,25';
    const res = await service.importCsv(ctx, 't1', csv);
    expect(res.created).toBe(2);
    expect(recordRepo.insertMany).toHaveBeenCalledTimes(1);
    expect(recordRepo.insertMany.mock.calls[0][0]).toHaveLength(2);
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

  it('rejects an import over MAX_IMPORT_ROWS with a clear BadRequestException before processing', async () => {
    const { service, recordRepo } = make();
    const header = 'Name';
    const tooManyRows = Array.from({ length: 5001 }, (_, i) => `Row${i}`).join(
      '\n',
    );
    const csv = `${header}\n${tooManyRows}`;

    await expect(service.importCsv(ctx, 't1', csv)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.importCsv(ctx, 't1', csv)).rejects.toThrow(/5000/);
    // Bound is enforced BEFORE any row processing — no insert attempted.
    expect(recordRepo.insertMany).not.toHaveBeenCalled();
  });
});
