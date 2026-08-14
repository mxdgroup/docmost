import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { InsertableMxdRecord, MxdField } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { MxdComputeService } from './mxd-compute.service';
import { getFieldType } from '../field-types/field-types.registry';
import { FieldConfig, FieldValidationError } from '../field-types/field-type';
import { parseCsv, serializeCsv, renderCsvCell } from '../csv/csv';

// Bounds — export never streams the whole table unbounded; import is capped so a
// single request can't fan out into an unbounded create storm.
const EXPORT_PAGE = 200;
const MAX_EXPORT_ROWS = 50000;
// MAX_IMPORT_ROWS is the explicit, enforced ceiling for the SYNCHRONOUS import
// path: importCsv validates + inserts every row within one HTTP request/
// transaction, so this is not a soft hint — it's the hard bound past which we
// reject the request outright (review P1). Raise it only alongside moving
// import to a background job; until then this is the real ceiling.
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5MB

// Field types whose stored value is an ID (option id / user id), not the label a
// human would put in a CSV cell — so a plain CSV can't round-trip them safely.
// Excluded from import mapping and reported back as unsupported columns.
const NON_CSV_IMPORTABLE = new Set(['select', 'multi_select', 'user']);

export interface CsvExportResult {
  filename: string;
  csv: string;
  rowCount: number;
  truncated: boolean;
}

export interface CsvImportResult {
  created: number;
  totalRows: number;
  errors: { row: number; message: string }[];
  unmappedColumns: string[];
}

// MXD data platform — CSV import/export. Export authorizes READ and renders every
// field (including computed) to a lossless CSV.
//
// Import authorizes WRITE ONCE, then runs a bounded, transactional BULK insert
// (review P1 fix) instead of calling recordService.createRecord per row:
// per-row calls each re-ran authz + fieldRepo.listByTable + a table-scanning
// maxPosition + an awaited automation emit, making a 5000-row import
// O(existingRows*n + n^2) and prone to HTTP timeouts / partial imports with no
// transaction. Import now does authz + fieldRepo.listByTable + maxPosition
// ONCE, validates/normalizes every row in memory (same field-type registry
// `normalize()` the record service uses, so validation semantics are
// unchanged), assigns positions in memory, and inserts all valid rows via
// MxdRecordRepo.insertMany in one DB transaction.
//
// Deliberate v1 bound/trade-off: bulk import does NOT run per-row automations
// and does NOT write per-row history entries — that per-row fan-out was the
// O(n^2) cost being fixed here. A single bounded, transactional insert with no
// automation/history fan-out is the accepted v1 shape (not a background job
// system); MAX_IMPORT_ROWS is the explicit, enforced synchronous ceiling.
@Injectable()
export class MxdCsvService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
    private readonly compute: MxdComputeService,
  ) {}

  async exportCsv(ctx: MxdContext, tableId: string): Promise<CsvExportResult> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeRead(ctx, table);

    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const header = fields.map((f) => f.name);
    const dataRows: string[][] = [];
    let offset = 0;
    let truncated = false;

    while (true) {
      const page = await this.recordRepo.list(
        ctx.workspaceId,
        tableId,
        EXPORT_PAGE,
        offset,
      );
      if (page.items.length === 0) break;
      const enriched = await this.compute.enrich(ctx, fields, page.items);
      for (const rec of enriched) {
        if (dataRows.length >= MAX_EXPORT_ROWS) {
          truncated = true;
          break;
        }
        const data = (rec.data as Record<string, unknown>) ?? {};
        dataRows.push(fields.map((f) => renderCsvCell(data[f.id])));
      }
      if (truncated || page.items.length < EXPORT_PAGE) break;
      offset += EXPORT_PAGE;
    }

    const safeTitle = (table.title || 'table')
      .replace(/[^a-z0-9-_]+/gi, '_')
      .slice(0, 60);
    return {
      filename: `${safeTitle}.csv`,
      csv: serializeCsv([header, ...dataRows]),
      rowCount: dataRows.length,
      truncated,
    };
  }

  async importCsv(
    ctx: MxdContext,
    tableId: string,
    csvText: string,
  ): Promise<CsvImportResult> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeWrite(ctx, table);

    if (typeof csvText !== 'string' || csvText.length === 0) {
      throw new BadRequestException('CSV content is required');
    }
    if (csvText.length > MAX_IMPORT_BYTES) {
      throw new BadRequestException('CSV exceeds the 5MB import limit');
    }

    const rows = parseCsv(csvText);
    if (rows.length === 0) throw new BadRequestException('CSV is empty');

    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const byName = new Map(
      fields.map((f) => [f.name.trim().toLowerCase(), f]),
    );

    const header = rows[0].map((h) => h.trim());
    const unmappedColumns: string[] = [];
    // Resolve each header column to a settable field (or null if it can't be
    // imported — unknown, computed, relation, or id-backed).
    const colFields: (MxdField | null)[] = header.map((h) => {
      const f = byName.get(h.toLowerCase());
      if (!f) {
        if (h !== '') unmappedColumns.push(h);
        return null;
      }
      const type = getFieldType(f.type);
      if (type.isComputed || type.isRelation || NON_CSV_IMPORTABLE.has(f.type)) {
        unmappedColumns.push(h);
        return null;
      }
      return f;
    });

    if (colFields.every((f) => f === null)) {
      throw new BadRequestException(
        'No CSV column maps to an importable field (check the header names)',
      );
    }

    const dataRows = rows.slice(1);
    // EXPLICIT, ENFORCED bound checked BEFORE any row processing — see
    // MAX_IMPORT_ROWS comment above for why this is a hard synchronous ceiling.
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(
        `Too many rows: ${dataRows.length} (max ${MAX_IMPORT_ROWS} per import — this is a synchronous, bounded import; split larger CSVs into multiple files)`,
      );
    }

    // authz + fieldRepo.listByTable already ran ONCE above. Compute the
    // starting position ONCE here too — every valid row below gets an
    // in-memory incrementing position instead of a per-row maxPosition scan.
    let nextPosition = await this.recordRepo.maxPosition(
      ctx.workspaceId,
      tableId,
    );

    const errors: { row: number; message: string }[] = [];
    const validRows: InsertableMxdRecord[] = [];

    for (let r = 0; r < dataRows.length; r++) {
      const rowVals = dataRows[r];
      if (rowVals.every((v) => v.trim() === '')) continue; // skip blank lines

      // +2: 1 for the header row, 1 for 1-based line numbering.
      const rowNumber = r + 2;
      const cells: Record<string, unknown> = {};
      let rowError: string | null = null;

      for (let c = 0; c < colFields.length; c++) {
        const f = colFields[c];
        if (!f) continue;
        const raw = rowVals[c];
        if (raw === undefined || raw === '') continue; // leave unset
        try {
          // Same normalize() every manual create runs through
          // (MxdRecordService.validateCells) — validation semantics are
          // unchanged, only the per-row service round-trip is removed.
          cells[f.id] = getFieldType(f.type).normalize(
            this.coerce(f, raw),
            (f.config ?? {}) as FieldConfig,
          );
        } catch (e) {
          rowError =
            e instanceof FieldValidationError
              ? `${f.name}: ${e.message}`
              : String((e as any)?.message ?? e);
          break;
        }
      }

      if (rowError) {
        // A bad row is skipped and reported — it never aborts the import or
        // rolls back rows already found valid.
        errors.push({ row: rowNumber, message: rowError.slice(0, 200) });
        continue;
      }

      nextPosition += 1;
      validRows.push({
        tableId,
        workspaceId: ctx.workspaceId,
        data: cells as any,
        position: nextPosition,
        version: 1,
        creatorId: ctx.userId,
        creatorGuestName: ctx.userId ? null : ctx.guestName ?? null,
        updatedById: ctx.userId,
      });
    }

    // Single transactional bulk insert (chunked internally) — all valid rows
    // commit together, or none do on a DB-level failure. Validation errors
    // above are independent of this and are still reported per-row even
    // though they never reach the insert.
    const inserted = await this.recordRepo.insertMany(validRows);

    return {
      created: inserted.length,
      totalRows: dataRows.length,
      errors,
      unmappedColumns: [...new Set(unmappedColumns)],
    };
  }

  // Coerce a raw CSV string to the shape the field validator expects. Numbers,
  // dates, url, email accept strings directly; checkbox needs a truthy-string
  // interpretation. Everything else passes through and is validated downstream.
  private coerce(field: MxdField, raw: string): unknown {
    if (field.type === 'checkbox') {
      const v = raw.trim().toLowerCase();
      return v === 'true' || v === '1' || v === 'yes' || v === 'y';
    }
    return raw;
  }
}
