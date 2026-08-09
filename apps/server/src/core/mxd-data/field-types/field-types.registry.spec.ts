import { FieldValidationError } from './field-type';
import {
  getFieldType,
  isKnownFieldType,
  listFieldTypes,
} from './field-types.registry';

const norm = (type: string, value: unknown, config: any = {}) =>
  getFieldType(type).normalize(value, config);

describe('MXD field-type registry', () => {
  it('exposes the roadmap type set and rejects unknown types', () => {
    const types = listFieldTypes();
    for (const t of [
      'text',
      'long_text',
      'number',
      'currency',
      'percent',
      'checkbox',
      'date',
      'datetime',
      'select',
      'multi_select',
      'url',
      'email',
      'user',
      'relation',
      'lookup',
      'rollup',
      'formula',
    ]) {
      expect(types).toContain(t);
    }
    expect(isKnownFieldType('text')).toBe(true);
    expect(isKnownFieldType('nope')).toBe(false);
    expect(() => getFieldType('nope')).toThrow(FieldValidationError);
  });

  describe('text / long_text', () => {
    it('accepts strings and coerces primitives', () => {
      expect(norm('text', 'hi')).toBe('hi');
      expect(norm('text', 42)).toBe('42');
      expect(norm('text', '')).toBeNull();
    });
    it('rejects overlong input', () => {
      expect(() => norm('text', 'x'.repeat(10_001))).toThrow(
        FieldValidationError,
      );
      expect(norm('long_text', 'x'.repeat(50_000))).toHaveLength(50_000);
    });
  });

  describe('number / currency / percent', () => {
    it('parses and applies precision', () => {
      expect(norm('number', '3.14159', { precision: 2 })).toBe(3.14);
      expect(norm('currency', 10)).toBe(10);
      expect(norm('percent', '', {})).toBeNull();
    });
    it('rejects non-numbers', () => {
      expect(() => norm('number', 'abc')).toThrow(FieldValidationError);
      expect(() => norm('number', NaN)).toThrow(FieldValidationError);
      expect(() => norm('number', Infinity)).toThrow(FieldValidationError);
    });
  });

  describe('checkbox', () => {
    it('normalizes truthy/falsey forms', () => {
      expect(norm('checkbox', true)).toBe(true);
      expect(norm('checkbox', 'true')).toBe(true);
      expect(norm('checkbox', 0)).toBe(false);
      expect(norm('checkbox', null)).toBe(false);
    });
    it('rejects garbage', () => {
      expect(() => norm('checkbox', 'maybe')).toThrow(FieldValidationError);
    });
  });

  describe('date / datetime', () => {
    it('validates shape', () => {
      expect(norm('date', '2026-08-09')).toBe('2026-08-09');
      expect(norm('datetime', '2026-08-09T10:00:00Z')).toBe(
        '2026-08-09T10:00:00.000Z',
      );
    });
    it('rejects bad input', () => {
      expect(() => norm('date', '08/09/2026')).toThrow(FieldValidationError);
      expect(() => norm('date', '2026-13-40')).toThrow(FieldValidationError);
      expect(() => norm('datetime', 'not-a-date')).toThrow(
        FieldValidationError,
      );
    });
  });

  describe('select / multi_select', () => {
    const config = {
      choices: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    };
    it('enforces the choice set', () => {
      expect(norm('select', 'a', config)).toBe('a');
      expect(() => norm('select', 'z', config)).toThrow(FieldValidationError);
      expect(norm('multi_select', ['a', 'b', 'a'], config)).toEqual([
        'a',
        'b',
      ]); // dedup
      expect(() => norm('multi_select', ['a', 'z'], config)).toThrow(
        FieldValidationError,
      );
      expect(() => norm('multi_select', 'a', config)).toThrow(
        FieldValidationError,
      );
    });
  });

  describe('url / email', () => {
    it('accepts safe values', () => {
      expect(norm('url', 'https://example.com/')).toBe('https://example.com/');
      expect(norm('email', 'a@b.co')).toBe('a@b.co');
    });
    it('rejects dangerous url schemes (XSS)', () => {
      expect(() => norm('url', 'javascript:alert(1)')).toThrow(
        FieldValidationError,
      );
      expect(() => norm('url', 'data:text/html,x')).toThrow(
        FieldValidationError,
      );
      expect(() => norm('url', 'not a url')).toThrow(FieldValidationError);
    });
    it('rejects malformed email', () => {
      expect(() => norm('email', 'nope')).toThrow(FieldValidationError);
    });
  });

  describe('relation and computed types refuse direct cell writes', () => {
    it('relation writes go through the relation API', () => {
      expect(getFieldType('relation').isRelation).toBe(true);
      expect(() => norm('relation', 'anything')).toThrow(FieldValidationError);
    });
    it('computed cells are read-only', () => {
      for (const t of [
        'formula',
        'lookup',
        'rollup',
        'created_time',
        'updated_time',
        'created_by',
        'updated_by',
        'autonumber',
      ]) {
        expect(getFieldType(t).isComputed).toBe(true);
        expect(() => norm(t, 'x')).toThrow(FieldValidationError);
      }
    });
  });

  // Type conversion semantics (roadmap §7): converting a field's type means
  // re-normalizing each existing cell under the NEW type. A value that
  // normalizes is safely convertible; one that throws is incompatible and the
  // field service must refuse or require an explicit path — never silently drop.
  describe('type conversion (re-normalization)', () => {
    it('text→number: convertible when numeric, incompatible otherwise', () => {
      expect(norm('number', '42')).toBe(42); // safe
      expect(() => norm('number', 'hello')).toThrow(FieldValidationError); // incompatible
    });
    it('number→text: always safe', () => {
      expect(norm('text', 42)).toBe('42');
    });
    it('select→text: safe; text→select: only if it matches a choice', () => {
      const cfg = { choices: [{ id: 'a', label: 'A' }] };
      expect(norm('text', 'a')).toBe('a');
      expect(norm('select', 'a', cfg)).toBe('a');
      expect(() => norm('select', 'freeform', cfg)).toThrow(
        FieldValidationError,
      );
    });
    it('preserves nulls rather than discarding', () => {
      expect(norm('number', null)).toBeNull();
      expect(norm('text', '')).toBeNull();
    });
  });
});
