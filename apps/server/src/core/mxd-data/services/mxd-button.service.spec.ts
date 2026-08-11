import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdButtonService } from './mxd-button.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name' },
  { id: 'f_due', type: 'date', name: 'Due' },
  { id: 'f_btn', type: 'button', name: 'Go' },
];

function make(over: any = {}) {
  const buttonConfig = over.buttonConfig ?? {
    actions: [
      { type: 'setField', fieldId: 'f_name', value: 'x' },
      { type: 'setNow', fieldId: 'f_due' },
      { type: 'openUrl', url: 'https://example.com' },
      { type: 'createRecord', cells: { f_name: 'new' } },
    ],
  };
  const tableRepo = {
    findById: jest.fn().mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1' }),
  };
  const fieldRepo = {
    findById: jest.fn().mockResolvedValue(
      over.buttonField ?? { id: 'f_btn', type: 'button', config: buttonConfig },
    ),
    listByTable: jest.fn().mockResolvedValue(fields),
  };
  const recordRepo = {
    findById: jest
      .fn()
      .mockResolvedValue('record' in over ? over.record : { id: 'r1', version: 3 }),
  };
  const access = { authorizeWrite: jest.fn().mockResolvedValue(undefined) };
  const recordService = {
    updateRecord: jest.fn().mockResolvedValue({ id: 'r1', version: 4 }),
    createRecord: jest.fn().mockResolvedValue({ id: 'r2' }),
  };
  const service = new MxdButtonService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
    recordService as any,
  );
  return { service, tableRepo, fieldRepo, recordRepo, access, recordService };
}

describe('MxdButtonService', () => {
  it('runs declarative actions server-side after authorizing write', async () => {
    const { service, access, recordService } = make();
    const res = await service.run(ctx, 't1', 'f_btn', 'r1');
    expect(access.authorizeWrite).toHaveBeenCalled();
    // setField + setNow applied in one version-checked update
    const upd = recordService.updateRecord.mock.calls[0];
    expect(upd[3]).toBe(3); // version
    expect(upd[4].f_name).toBe('x');
    expect(typeof upd[4].f_due).toBe('string'); // setNow -> a date string
    // createRecord executed
    expect(recordService.createRecord).toHaveBeenCalledWith(ctx, 't1', {
      f_name: 'new',
    });
    // openUrl returned as a client directive, NOT executed
    expect(res.directives).toEqual([
      { type: 'openUrl', url: 'https://example.com' },
    ]);
  });

  it('rejects running a non-button field', async () => {
    const { service } = make({ buttonField: { id: 'f_name', type: 'text' } });
    await expect(service.run(ctx, 't1', 'f_name', 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s when the record is missing', async () => {
    const { service } = make({ record: undefined });
    await expect(service.run(ctx, 't1', 'f_btn', 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('re-validates the button config at run time (rejects a bad action)', async () => {
    const { service } = make({
      buttonConfig: { actions: [{ type: 'setField', fieldId: 'ghost', value: 1 }] },
    });
    await expect(service.run(ctx, 't1', 'f_btn', 'r1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
