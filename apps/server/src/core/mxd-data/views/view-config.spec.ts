import { BadRequestException } from '@nestjs/common';
import { validateViewConfig, FilterGroup } from './view-config';

const fields = [
  { id: 'f_text', type: 'text', name: 'Text' },
  { id: 'f_num', type: 'number', name: 'Num' },
  { id: 'f_check', type: 'checkbox', name: 'Done' },
] as any[];

const v = (config: any) => validateViewConfig(fields, config);

describe('validateViewConfig', () => {
  it('accepts a valid config', () => {
    expect(
      v({
        visibleFields: ['f_text', 'f_num'],
        sorts: [{ fieldId: 'f_num', direction: 'desc' }],
        filter: {
          combinator: 'and',
          conditions: [
            { fieldId: 'f_text', op: 'contains', value: 'x' },
            { fieldId: 'f_num', op: 'gt', value: 3 },
          ],
        },
        displayFieldId: 'f_text',
      }),
    ).toBeTruthy();
  });

  it('rejects a field id not on the table (any slot)', () => {
    expect(() => v({ visibleFields: ['ghost'] })).toThrow(BadRequestException);
    expect(() => v({ displayFieldId: 'ghost' })).toThrow(BadRequestException);
    expect(() =>
      v({ sorts: [{ fieldId: 'ghost', direction: 'asc' }] }),
    ).toThrow(BadRequestException);
    expect(() =>
      v({ filter: { combinator: 'and', conditions: [{ fieldId: 'ghost', op: 'contains' }] } }),
    ).toThrow(BadRequestException);
  });

  it('rejects an operator illegal for the field type', () => {
    // gt is not a text operator
    expect(() =>
      v({ filter: { combinator: 'and', conditions: [{ fieldId: 'f_text', op: 'gt', value: 1 }] } }),
    ).toThrow(BadRequestException);
    // contains is not a checkbox operator
    expect(() =>
      v({ filter: { combinator: 'and', conditions: [{ fieldId: 'f_check', op: 'contains' }] } }),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid sort direction', () => {
    expect(() => v({ sorts: [{ fieldId: 'f_num', direction: 'sideways' }] })).toThrow(
      BadRequestException,
    );
  });

  it('bounds filter nesting depth', () => {
    let node: FilterGroup = { combinator: 'and', conditions: [{ fieldId: 'f_num', op: 'gt', value: 1 }] };
    for (let i = 0; i < 6; i++) node = { combinator: 'and', conditions: [node] };
    expect(() => v({ filter: node })).toThrow(BadRequestException);
  });

  it('bounds total filter conditions', () => {
    const conditions = Array.from({ length: 60 }, () => ({ fieldId: 'f_num', op: 'gt', value: 1 }));
    expect(() => v({ filter: { combinator: 'or', conditions } })).toThrow(BadRequestException);
  });

  it('bounds sort count', () => {
    const sorts = Array.from({ length: 10 }, () => ({ fieldId: 'f_num', direction: 'asc' }));
    expect(() => v({ sorts })).toThrow(BadRequestException);
  });

  it('rejects an oversized filter value', () => {
    expect(() =>
      v({ filter: { combinator: 'and', conditions: [{ fieldId: 'f_text', op: 'contains', value: 'x'.repeat(3000) }] } }),
    ).toThrow(BadRequestException);
  });
});
