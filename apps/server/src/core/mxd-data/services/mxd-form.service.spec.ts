import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdFormService } from './mxd-form.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name', config: {} },
  { id: 'f_age', type: 'number', name: 'Age', config: {} },
  { id: 'f_calc', type: 'formula', name: 'Calc', config: {} },
  { id: 'f_rel', type: 'relation', name: 'Rel', config: {} },
];

function make(over: any = {}) {
  const formRepo = {
    insert: jest.fn().mockImplementation(async (v: any) => ({ id: 'form1', ...v })),
    findById: jest.fn().mockResolvedValue({ id: 'form1' }),
    listByTable: jest.fn().mockResolvedValue([]),
    findByKey: jest.fn().mockResolvedValue(
      'form' in over
        ? over.form
        : {
            id: 'form1',
            key: 'k1',
            workspaceId: 'ws1',
            tableId: 't1',
            title: 'Signup',
            description: null,
            submitMessage: null,
            enabled: true,
            fieldIds: ['f_name', 'f_age'],
          },
    ),
    update: jest.fn().mockImplementation(async (_w, _t, id, p) => ({ id, ...p })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const tableRepo = {
    findById: jest
      .fn()
      .mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1', workspaceId: 'ws1' }),
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const recordService = {
    createFromTrustedSource: jest.fn().mockImplementation(async (_ctx, tableId, cells) => ({
      id: 'r1',
      tableId,
      data: cells,
    })),
  };
  const shareRepo = {
    isSharingAllowed:
      'isSharingAllowed' in over
        ? over.isSharingAllowed
        : jest.fn().mockResolvedValue(true),
  };
  const service = new MxdFormService(
    formRepo as any,
    tableRepo as any,
    fieldRepo as any,
    access as any,
    recordService as any,
    shareRepo as any,
  );
  return { service, formRepo, tableRepo, access, recordService, shareRepo };
}

describe('MxdFormService — authenticated', () => {
  it('creates a form with a generated key and whitelisted fields', async () => {
    const { service, formRepo, access } = make();
    const form = await service.createForm(ctx, 't1', {
      title: 'Signup',
      fieldIds: ['f_name', 'f_age'],
    });
    expect(access.authorizeWrite).toHaveBeenCalled();
    const inserted = formRepo.insert.mock.calls[0][0];
    expect(inserted.fieldIds).toEqual(['f_name', 'f_age']);
    expect(typeof inserted.key).toBe('string');
    expect(inserted.key.length).toBeGreaterThan(6);
    expect(form.id).toBe('form1');
  });

  it('rejects a form that collects a computed or relation field', async () => {
    const { service } = make();
    await expect(
      service.createForm(ctx, 't1', { fieldIds: ['f_name', 'f_calc'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createForm(ctx, 't1', { fieldIds: ['f_rel'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty field list', async () => {
    const { service } = make();
    await expect(
      service.createForm(ctx, 't1', { fieldIds: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MxdFormService — public', () => {
  it('getPublicForm returns only the whitelisted fields', async () => {
    const { service } = make();
    const pub = await service.getPublicForm('k1');
    expect(pub.fields.map((f) => f.id)).toEqual(['f_name', 'f_age']);
    expect(pub.title).toBe('Signup');
  });

  it('a disabled or missing form is a 404 to the public', async () => {
    const disabled = make({ form: { enabled: false, fieldIds: [] } });
    await expect(disabled.service.getPublicForm('k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const missing = make({ form: undefined });
    await expect(missing.service.submitForm('k1', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('submit validates + creates a record through the trusted-source record path', async () => {
    const { service, recordService } = make();
    await service.submitForm('k1', { f_name: 42, f_age: '7' });
    expect(recordService.createFromTrustedSource).toHaveBeenCalledTimes(1);
    const [anonCtx, tableId, cells] =
      recordService.createFromTrustedSource.mock.calls[0];
    expect(cells).toEqual({ f_name: 42, f_age: '7' }); // normalization happens in MxdRecordService
    expect(tableId).toBe('t1');
    expect(anonCtx.userId).toBeNull();
    expect(anonCtx.guestName).toBe('Form');
    expect(anonCtx.workspaceId).toBe('ws1');
  });

  it('submit rejects a value for a field not on the form (even if it exists)', async () => {
    const { service, recordService } = make();
    await expect(
      service.submitForm('k1', { f_name: 'ok', f_calc: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recordService.createFromTrustedSource).not.toHaveBeenCalled();
  });

  it('submit is rejected with 404 when the sharing kill switch is off', async () => {
    const isSharingAllowed = jest.fn().mockResolvedValue(false);
    const { service, recordService } = make({ isSharingAllowed });
    await expect(service.submitForm('k1', { f_name: 'ok' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(recordService.createFromTrustedSource).not.toHaveBeenCalled();
  });

  it('getPublicForm is rejected with 404 when the sharing kill switch is off', async () => {
    const isSharingAllowed = jest.fn().mockResolvedValue(false);
    const { service, tableRepo } = make({ isSharingAllowed });
    await expect(service.getPublicForm('k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(isSharingAllowed).toHaveBeenCalledWith('ws1', 's1');
    expect(tableRepo.findById).toHaveBeenCalled();
  });
});

// The unified write path itself (validation, history, automation dispatch) is
// covered by mxd-record.service.spec.ts — createFromTrustedSource shares the
// exact same implementation as createRecord (createRecordCore), so those
// assertions apply here too rather than being duplicated.
