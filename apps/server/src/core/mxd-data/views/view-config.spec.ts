import { BadRequestException } from '@nestjs/common';
import {
  validateViewConfig,
  validateViewConfigForType,
  FilterGroup,
} from './view-config';

const fields = [
  { id: 'f_text', type: 'text', name: 'Text' },
  { id: 'f_num', type: 'number', name: 'Num' },
  { id: 'f_check', type: 'checkbox', name: 'Done' },
  { id: 'f_due', type: 'date', name: 'Due' },
  { id: 'f_calc', type: 'formula', name: 'Calc' },
] as any[];

const v = (config: any) => validateViewConfig(fields, config);
const vt = (type: any, config: any) =>
  validateViewConfigForType(fields, type, config);

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

describe('validateViewConfigForType', () => {
  it('grid/list/gallery impose no extra config requirement', () => {
    expect(vt('grid', {})).toBeTruthy();
    expect(vt('list', {})).toBeTruthy();
    expect(vt('gallery', { displayFieldId: 'f_text' })).toBeTruthy();
  });

  it('calendar requires a date/datetime displayFieldId', () => {
    expect(() => vt('calendar', {})).toThrow(BadRequestException); // missing
    expect(() => vt('calendar', { displayFieldId: 'f_text' })).toThrow(
      BadRequestException,
    ); // wrong type
    expect(vt('calendar', { displayFieldId: 'f_due' })).toBeTruthy(); // date OK
  });

  it('board rejects grouping by a computed field but allows a discrete one', () => {
    expect(() => vt('board', { groupByFieldId: 'f_calc' })).toThrow(
      BadRequestException,
    );
    expect(vt('board', { groupByFieldId: 'f_text' })).toBeTruthy();
    expect(vt('board', {})).toBeTruthy(); // grouping optional
  });
});
