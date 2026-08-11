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
      { type: 'openUrl', url: 'https://example.com' },
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
  const actionRunner = {
    run: jest.fn().mockResolvedValue({
      directives: [{ type: 'openUrl', url: 'https://example.com' }],
    }),
  };
  const service = new MxdButtonService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
    actionRunner as any,
  );
  return { service, tableRepo, fieldRepo, recordRepo, access, actionRunner };
}

describe('MxdButtonService', () => {
  it('authorizes write, validates config, then delegates to the action runner (openUrl allowed)', async () => {
    const { service, access, actionRunner } = make();
    const res = await service.run(ctx, 't1', 'f_btn', 'r1');
    expect(access.authorizeWrite).toHaveBeenCalled();
    const call = actionRunner.run.mock.calls[0];
    expect(call[0]).toBe(ctx);
    expect(call[1]).toBe('t1');
    expect(call[2]).toBe('r1');
    // a button run permits openUrl directives (unlike an automation)
    expect(call[4]).toEqual({ allowOpenUrl: true });
    expect(res).toEqual({
      success: true,
      directives: [{ type: 'openUrl', url: 'https://example.com' }],
    });
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
