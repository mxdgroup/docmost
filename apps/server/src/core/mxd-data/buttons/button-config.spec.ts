import { BadRequestException } from '@nestjs/common';
import { validateButtonConfig } from './button-config';

const fields = [
  { id: 'f_name', type: 'text', name: 'Name' },
  { id: 'f_due', type: 'date', name: 'Due' },
  { id: 'f_calc', type: 'formula', name: 'Calc' },
  { id: 'f_btn', type: 'button', name: 'Go' },
] as any[];

const v = (config: any) => validateButtonConfig(fields, config);

describe('validateButtonConfig', () => {
  it('accepts a valid set of actions', () => {
    expect(
      v({
        label: 'Do it',
        actions: [
          { type: 'setField', fieldId: 'f_name', value: 'x' },
          { type: 'setNow', fieldId: 'f_due' },
          { type: 'clearField', fieldId: 'f_name' },
          { type: 'createRecord', cells: { f_name: 'new' } },
          { type: 'openUrl', url: 'https://example.com' },
        ],
      }),
    ).toBeTruthy();
  });

  it('requires a non-empty actions array', () => {
    expect(() => v({ actions: [] })).toThrow(BadRequestException);
    expect(() => v({})).toThrow(BadRequestException);
    expect(() => v(null)).toThrow(BadRequestException);
  });

  it('bounds the number of actions', () => {
    const actions = Array.from({ length: 11 }, () => ({
      type: 'setField',
      fieldId: 'f_name',
      value: 'x',
    }));
    expect(() => v({ actions })).toThrow(BadRequestException);
  });

  it('rejects setting an unknown or non-settable field', () => {
    expect(() => v({ actions: [{ type: 'setField', fieldId: 'ghost', value: 1 }] })).toThrow(
      BadRequestException,
    );
    // computed field can't be set
    expect(() => v({ actions: [{ type: 'setField', fieldId: 'f_calc', value: 1 }] })).toThrow(
      BadRequestException,
    );
  });

  it('setNow must target a date/datetime field', () => {
    expect(() => v({ actions: [{ type: 'setNow', fieldId: 'f_name' }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects a dangerous or invalid openUrl', () => {
    expect(() => v({ actions: [{ type: 'openUrl', url: 'javascript:alert(1)' }] })).toThrow(
      BadRequestException,
    );
    expect(() => v({ actions: [{ type: 'openUrl', url: 'not a url' }] })).toThrow(
      BadRequestException,
    );
  });

  it('createRecord cells must reference real fields', () => {
    expect(() => v({ actions: [{ type: 'createRecord', cells: { ghost: 1 } }] })).toThrow(
      BadRequestException,
    );
  });

  it('rejects an unknown action type', () => {
    expect(() => v({ actions: [{ type: 'runShell', cmd: 'rm -rf /' }] })).toThrow(
      BadRequestException,
    );
  });
});
