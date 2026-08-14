import { BadRequestException } from '@nestjs/common';
import { RawBuilder, SqlBool, sql } from 'kysely';
import { MxdField } from '@docmost/db/types/entity.types';
import { FilterCondition, FilterGroup, Sort } from './view-config';

// MXD data platform — compiles a VALIDATED filter/sort config into safe SQL over
// mxd_records.data jsonb (roadmap §16/§18). Safety invariants:
//   - field ids are bound PARAMETERS in the jsonb path (data ->> $id), never
//     interpolated into SQL text;
//   - every value is a bound parameter;
//   - operators dispatch through a switch (allowlist) — an unknown operator
//     throws instead of reaching raw SQL;
//   - combinators are chosen from fixed sql fragments, never client strings;
//   - no field name / JSON path / operator / sort expression is ever taken as a
//     raw string from the client.
// The config is assumed already validated by validateViewConfig.

// (data ->> $fieldId) — fieldId is a bound param.
const cellText = (fieldId: string) =>
  sql`(${sql.ref('data')} ->> ${fieldId})`;
// (data -> $fieldId) — jsonb, for array/multi operators.
const cellJson = (fieldId: string) => sql`(${sql.ref('data')} -> ${fieldId})`;

// System field types are NOT stored in `data` — their values live in real
// record columns. Map them to the column so filter/sort operate on the actual
// value (review P1: previously these compiled to data ->> id, which is always
// null, so filtering/sorting them was silently a no-op). The column name is a
// fixed allowlist value (never client-supplied), cast to text so every operator
// below behaves exactly as it does for a jsonb text cell.
const SYSTEM_COLUMN: Record<string, string> = {
  created_time: 'createdAt',
  updated_time: 'updatedAt',
  created_by: 'creatorId',
  updated_by: 'updatedById',
  autonumber: 'position',
};
// Text-valued cell expression for a field: a real column for system types,
// otherwise the jsonb path. sql.ref + CamelCasePlugin maps createdAt ->
// "created_at" for the identifier, matching the rest of the repo.
const cellExpr = (field: MxdField) => {
  const col = SYSTEM_COLUMN[field.type];
  return col ? sql`(${sql.ref(col)})::text` : cellText(field.id);
};

function escapeLike(v: string): string {
  return v.replace(/([\\%_])/g, '\\$1');
}
function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('This operator expects an array value');
  }
  return value.map((x) => String(x));
}
function isGroup(n: FilterCondition | FilterGroup): n is FilterGroup {
  return (n as FilterGroup).combinator !== undefined;
}

const DATE_TYPES = new Set([
  'date',
  'datetime',
  'created_time',
  'updated_time',
]);

function compileCondition(
  fieldsById: Map<string, MxdField>,
  c: FilterCondition,
): RawBuilder<SqlBool> {
  const field = fieldsById.get(c.fieldId);
  if (!field) {
    throw new BadRequestException('Unknown filter field');
  }
  const isDate = DATE_TYPES.has(field.type);
  const t = cellExpr(field);
  const j = cellJson(c.fieldId);
  const v = c.value;

  switch (c.op) {
    case 'isEmpty':
      return sql<SqlBool>`(${t} is null or ${t} = '')`;
    case 'isNotEmpty':
      return sql<SqlBool>`(${t} is not null and ${t} <> '')`;

    case 'equals':
    case 'is':
      return sql<SqlBool>`${t} = ${String(v)}`;
    case 'notEquals':
    case 'isNot':
      return sql<SqlBool>`(${t} is distinct from ${String(v)})`;
    case 'contains':
      return sql<SqlBool>`${t} ilike ${'%' + escapeLike(String(v)) + '%'} escape '\\'`;
    case 'notContains':
      return sql<SqlBool>`(${t} not ilike ${'%' + escapeLike(String(v)) + '%'} escape '\\' or ${t} is null)`;

    case 'gt':
      return sql<SqlBool>`(${t})::numeric > ${Number(v)}`;
    case 'gte':
      return sql<SqlBool>`(${t})::numeric >= ${Number(v)}`;
    case 'lt':
      return sql<SqlBool>`(${t})::numeric < ${Number(v)}`;
    case 'lte':
      return sql<SqlBool>`(${t})::numeric <= ${Number(v)}`;
    case 'between': {
      const [a, b] = asArray(v);
      // Cast by field type — a date field's cells are ISO strings, not numeric.
      return isDate
        ? sql<SqlBool>`(${t})::timestamptz between ${String(a)}::timestamptz and ${String(b)}::timestamptz`
        : sql<SqlBool>`(${t})::numeric between ${Number(a)} and ${Number(b)}`;
    }

    case 'before':
      return sql<SqlBool>`(${t})::timestamptz < ${String(v)}::timestamptz`;
    case 'after':
      return sql<SqlBool>`(${t})::timestamptz > ${String(v)}::timestamptz`;
    case 'on':
      return sql<SqlBool>`(${t})::date = ${String(v)}::date`;

    case 'isTrue':
      return sql<SqlBool>`(${t})::boolean is true`;
    case 'isFalse':
      return sql<SqlBool>`(${t})::boolean is false`;

    case 'hasAny':
      return sql<SqlBool>`jsonb_exists_any(${j}, ${sql.val(asArray(v))}::text[])`;
    case 'hasAll':
      return sql<SqlBool>`jsonb_exists_all(${j}, ${sql.val(asArray(v))}::text[])`;
    case 'hasNone':
      return sql<SqlBool>`(not jsonb_exists_any(${j}, ${sql.val(asArray(v))}::text[]) or ${j} is null)`;

    default:
      throw new BadRequestException(`Unsupported filter operator: ${c.op}`);
  }
}

export function compileFilter(
  fieldsById: Map<string, MxdField>,
  group: FilterGroup,
): RawBuilder<SqlBool> {
  const parts = (group.conditions ?? []).map((node) =>
    isGroup(node)
      ? compileFilter(fieldsById, node)
      : compileCondition(fieldsById, node),
  );
  if (parts.length === 0) return sql<SqlBool>`true`;
  // Combinator is a fixed fragment, never a client string.
  const sep = group.combinator === 'or' ? sql` or ` : sql` and `;
  return sql<SqlBool>`(${sql.join(parts, sep)})`;
}

// Typed sort expression: numeric/date fields sort by their cast value, others by
// text. fieldId is a bound param.
export function sortExpr(field: MxdField): RawBuilder<unknown> {
  const t = cellExpr(field);
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'autonumber':
      return sql`(${t})::numeric`;
    case 'date':
    case 'datetime':
    case 'created_time':
    case 'updated_time':
      return sql`(${t})::timestamptz`;
    default:
      return t;
  }
}

export function orderBySpecs(
  fieldsById: Map<string, MxdField>,
  sorts: Sort[],
): { expr: RawBuilder<unknown>; direction: 'asc' | 'desc' }[] {
  return (sorts ?? []).map((s) => {
    const field = fieldsById.get(s.fieldId);
    if (!field) throw new BadRequestException('Unknown sort field');
    return {
      expr: sortExpr(field),
      direction: s.direction === 'desc' ? 'desc' : 'asc',
    };
  });
}
