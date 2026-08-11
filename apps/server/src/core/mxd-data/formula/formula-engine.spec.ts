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
