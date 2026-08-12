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
    findById: jest.fn().mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1' }),
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const recordRepo = {
    maxPosition: jest.fn().mockResolvedValue(0),
    insert: jest.fn().mockImplementation(async (v: any) => ({ id: 'r1', ...v })),
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const service = new MxdFormService(
    formRepo as any,
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
  );
  return { service, formRepo, recordRepo, access };
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

  it('submit validates + inserts a record with an anonymous creator', async () => {
    const { service, recordRepo } = make();
    await service.submitForm('k1', { f_name: 42, f_age: '7' });
    const rec = recordRepo.insert.mock.calls[0][0];
    expect(rec.data).toEqual({ f_name: '42', f_age: 7 }); // normalized
    expect(rec.creatorId).toBeNull();
    expect(rec.creatorGuestName).toBe('Form');
    expect(rec.tableId).toBe('t1');
  });

  it('submit rejects a value for a field not on the form (even if it exists)', async () => {
    const { service, recordRepo } = make();
    await expect(
      service.submitForm('k1', { f_name: 'ok', f_calc: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(recordRepo.insert).not.toHaveBeenCalled();
  });

  it('submit surfaces a field-type validation error', async () => {
    const { service } = make();
    await expect(
      service.submitForm('k1', { f_age: 'not-a-number' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
