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
});
