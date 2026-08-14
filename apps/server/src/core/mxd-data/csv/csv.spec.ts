import { parseCsv, serializeCsv, renderCsvCell } from './csv';

describe('parseCsv', () => {
  it('parses a simple grid', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(parseCsv('name,note\n"Smith, Jr.","said ""hi"""')).toEqual([
      ['name', 'note'],
      ['Smith, Jr.', 'said "hi"'],
    ]);
  });

  it('handles embedded newlines inside quotes', () => {
    expect(parseCsv('a\n"line1\nline2"')).toEqual([['a'], ['line1\nline2']]);
  });

  it('tolerates CRLF and a trailing newline without a spurious empty row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a leading UTF-8 BOM', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('round-trips through serializeCsv (quoting special chars)', () => {
    const rows = [
      ['name', 'note'],
      ['Smith, Jr.', 'a\nb'],
      ['x', 'say "hi"'],
    ];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
  });
});

describe('renderCsvCell', () => {
  it('renders scalars and JSON-encodes arrays/objects', () => {
    expect(renderCsvCell(null)).toBe('');
    expect(renderCsvCell(undefined)).toBe('');
    expect(renderCsvCell('hi')).toBe('hi');
    expect(renderCsvCell(42)).toBe('42');
    expect(renderCsvCell(true)).toBe('true');
    expect(renderCsvCell(['a', 'b'])).toBe('["a","b"]');
    expect(renderCsvCell({ error: 'x' })).toBe('{"error":"x"}');
  });

  // CSV formula injection (CWE-1236 / OWASP CSV Injection): a string cell
  // whose first character would be interpreted by Excel/Sheets/LibreOffice
  // as a formula prefix must be neutralized with a leading apostrophe.
  it('prefixes an apostrophe on values that could be read as spreadsheet formulas', () => {
    expect(renderCsvCell('=1+1')).toBe("'=1+1");
    expect(renderCsvCell('+1')).toBe("'+1");
    expect(renderCsvCell('-1')).toBe("'-1");
    expect(renderCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(renderCsvCell('\tfoo')).toBe("'\tfoo");
    expect(renderCsvCell('\rfoo')).toBe("'\rfoo");
  });

  it('does not prefix normal text or numeric-looking strings', () => {
    expect(renderCsvCell('hello')).toBe('hello');
    expect(renderCsvCell('42')).toBe('42');
  });

  it('does not prefix a value that merely contains a trigger character mid-string', () => {
    expect(renderCsvCell('a=b')).toBe('a=b');
  });

  it('does not double-apply the prefix', () => {
    expect(renderCsvCell(renderCsvCell('=1+1'))).toBe("'=1+1");
  });

  it('exports a neutralized formula value through serializeCsv, quoted as needed', () => {
    const csv = serializeCsv([[renderCsvCell('=1+1')]]);
    expect(csv).toBe("'=1+1\n");
    expect(parseCsv(csv)).toEqual([["'=1+1"]]);
  });
});
