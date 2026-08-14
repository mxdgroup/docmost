import { stringify } from 'csv-stringify/sync';

// MXD data platform — CSV helpers (roadmap: CSV import/export). A small,
// dependency-light RFC-4180 parser for import (csv-parse is not a dependency)
// and csv-stringify (already a dependency) for export. Kept pure and separately
// unit-tested so the service layer only deals with field mapping + validation.

// Parse RFC-4180 CSV text into a matrix of string cells. Handles quoted fields,
// escaped quotes (""), and embedded commas/newlines inside quotes. Tolerates
// both LF and CRLF line endings and a leading UTF-8 BOM. A trailing newline does
// not produce a spurious empty final row.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue; // fold CR; the following LF (or EOF) ends the line
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Flush the final field/row unless the input ended exactly on a row boundary.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Serialize a matrix of string rows to RFC-4180 CSV text (quoting handled by
// csv-stringify: fields with commas/quotes/newlines are quoted).
export function serializeCsv(rows: string[][]): string {
  return stringify(rows);
}

// Cell values starting with any of these characters are interpreted as
// formulas by Excel/Sheets/LibreOffice on open (CSV formula injection,
// CWE-1236 / OWASP CSV Injection). Anonymous form submissions can seed a
// text field with such a value, so any string cell is checked before export.
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

// Neutralize potential CSV formula injection by prefixing a leading
// apostrophe, which forces spreadsheet apps to treat the value as literal
// text instead of evaluating it as a formula. Applied before quote-escaping
// so the apostrophe is preserved inside the quoted field on round-trip.
function neutralizeCsvFormula(value: string): string {
  if (value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0])) {
    return `'${value}`;
  }
  return value;
}

// Render a stored/computed cell value to a CSV string. Scalars pass through;
// arrays/objects (multi-select, computed error cells, etc.) are JSON-encoded so
// the export stays lossless and unambiguous.
export function renderCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return neutralizeCsvFormula(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
