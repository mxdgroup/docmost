import {
  FormulaError,
  compileFormula,
  formulaDependencies,
} from './formula-engine';

const evl = (expr: string, fields: Record<string, unknown> = {}) =>
  compileFormula(expr).evaluate(fields);

describe('formula engine', () => {
  it('arithmetic with precedence', () => {
    expect(evl('1 + 2 * 3')).toBe(7);
    expect(evl('(1 + 2) * 3')).toBe(9);
    expect(evl('10 / 4')).toBe(2.5);
    expect(evl('-5 + 3')).toBe(-2);
  });

  it('field references resolve from record values', () => {
    expect(evl('{a} * {b}', { a: 6, b: 7 })).toBe(42);
    expect(evl('{missing}', {})).toBeNull();
  });

  it('comparisons and boolean logic', () => {
    expect(evl('3 > 2')).toBe(true);
    expect(evl('2 >= 2 && 1 < 0')).toBe(false);
    expect(evl('2 >= 2 || 1 < 0')).toBe(true);
    expect(evl('NOT (1 = 2)')).toBe(true);
  });

  it('IF / string ops', () => {
    expect(evl('IF({s} = "Won", {v}, 0)', { s: 'Won', v: 100 })).toBe(100);
    expect(evl('IF({s} = "Won", {v}, 0)', { s: 'Lost', v: 100 })).toBe(0);
    expect(evl('{first} + " " + {last}', { first: 'Ada', last: 'Lovelace' })).toBe(
      'Ada Lovelace',
    );
    expect(evl('CONCAT(UPPER("ab"), "-", LEN("xyz"))')).toBe('AB-3');
  });

  it('math functions', () => {
    expect(evl('ROUND(3.14159, 2)')).toBe(3.14);
    expect(evl('MAX(1, 9, 4)')).toBe(9);
    expect(evl('ABS(-7)')).toBe(7);
    expect(evl('COALESCE({x}, {y}, 5)', { x: null, y: null })).toBe(5);
  });

  describe('short-circuit / lazy evaluation', () => {
    it('IF does not evaluate the untaken branch (division by zero avoided)', () => {
      expect(evl('IF({x} = 0, 0, {y} / {x})', { x: 0, y: 10 })).toBe(0);
    });
    it('IF still evaluates and propagates errors from the taken branch', () => {
      expect(() =>
        evl('IF({x} = 0, {y} / {x}, 0)', { x: 0, y: 10 }),
      ).toThrow(FormulaError);
    });
    it('IF still takes the truthy branch normally', () => {
      expect(evl('IF({x} = 0, 0, {y} / {x})', { x: 2, y: 10 })).toBe(5);
    });
    it('nested IF short-circuits correctly at both levels', () => {
      const expr = 'IF({a} = 1, IF({b} = 0, 0, {c} / {b}), {d} / {a})';
      // a=1 -> takes inner IF; b=0 -> takes 0, so {c}/{b} must not evaluate.
      expect(evl(expr, { a: 1, b: 0, c: 10, d: 99 })).toBe(0);
      // a=0 -> takes {d}/{a}, which is a division by zero -> should throw.
      expect(() => evl(expr, { a: 0, b: 0, c: 10, d: 99 })).toThrow(
        FormulaError,
      );
    });
    it('AND short-circuits on first falsy arg', () => {
      expect(evl('AND(FALSE, {y} / 0 > 0)', { y: 10 })).toBe(false);
      expect(evl('AND(TRUE, TRUE)')).toBe(true);
      expect(evl('AND(TRUE, FALSE)')).toBe(false);
    });
    it('OR short-circuits on first truthy arg', () => {
      expect(evl('OR(TRUE, {y} / 0 > 0)', { y: 10 })).toBe(true);
      expect(evl('OR(FALSE, FALSE)')).toBe(false);
      expect(evl('OR(FALSE, TRUE)')).toBe(true);
    });
    it('NOT evaluates its single arg', () => {
      expect(evl('NOT(TRUE)')).toBe(false);
      expect(evl('NOT(FALSE)')).toBe(true);
    });
    it('IF with missing args still throws (arg-count validation preserved)', () => {
      expect(() => evl('IF({x} = 0)', { x: 0 })).toThrow(FormulaError);
    });
  });

  it('reports its field dependencies', () => {
    expect(formulaDependencies('{a} + IF({b} > 0, {c}, 0)').sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  describe('error containment (never crashes the table)', () => {
    const err = (expr: string, fields: any = {}) => () => evl(expr, fields);
    it('division by zero', () => {
      expect(err('1 / 0')).toThrow(FormulaError);
      expect(err('{a} % 0', { a: 5 })).toThrow(FormulaError);
    });
    it('type mismatch (non-numeric arithmetic)', () => {
      expect(err('{a} * 2', { a: 'hello' })).toThrow(FormulaError);
    });
    it('unknown function', () => {
      expect(err('BOGUS(1)')).toThrow(FormulaError);
    });
    it('malformed input', () => {
      expect(err('1 +')).toThrow(FormulaError);
      expect(err('(1 + 2')).toThrow(FormulaError);
      expect(err('"unterminated')).toThrow(FormulaError);
      expect(err('{unterminated')).toThrow(FormulaError);
    });
    it('excessive depth is rejected', () => {
      const deep = '('.repeat(200) + '1' + ')'.repeat(200);
      expect(err(deep)).toThrow(FormulaError);
    });
    it('oversized expression is rejected', () => {
      expect(err('1+'.repeat(3000) + '1')).toThrow(FormulaError);
    });
    it('does NOT execute arbitrary JS (no eval escape)', () => {
      expect(err('constructor')).toThrow(FormulaError); // bare ident w/o call
      expect(err('process')).toThrow(FormulaError);
    });
  });
});
