import { BadRequestException } from '@nestjs/common';
import { MxdField } from '@docmost/db/types/entity.types';
import { FilterOperator } from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';

// MXD data platform — view configuration (roadmap §14). A view is configuration
// over ONE table's records, never a copy. Everything here is validated
// server-side against the table's real fields and the field-type registry's
// operator allowlist — a view config arriving from a browser is untrusted.

export type SortDirection = 'asc' | 'desc';
export type FilterCombinator = 'and' | 'or';

export interface Sort {
  fieldId: string;
  direction: SortDirection;
}

export interface FilterCondition {
  fieldId: string;
  op: FilterOperator;
  value?: unknown;
}

export interface FilterGroup {
  combinator: FilterCombinator;
  conditions: (FilterCondition | FilterGroup)[];
}

export interface ViewConfig {
  visibleFields?: string[];
  fieldOrder?: string[];
  sorts?: Sort[];
  filter?: FilterGroup;
  groupByFieldId?: string;
  displayFieldId?: string;
}

export const VIEW_TYPES = [
  'grid',
  'list',
  'board',
  'calendar',
  'gallery',
] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

// Complexity bounds (roadmap §17) — an adversarial filter must not create
// unbounded SQL or evaluation cost.
const MAX_FILTER_DEPTH = 4;
const MAX_FILTER_CONDITIONS = 50;
const MAX_SORTS = 8;
const MAX_VALUE_LEN = 2000;

function isGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).combinator !== undefined;
}

// Drop any config references to fields that no longer exist on the table, so a
// STORED view keeps working after a field is deleted (roadmap §19/§33) instead
// of throwing. Safe: filters/sorts are display refinement over records the
// caller can already read — dropping one never widens access. Used on the query
// path; validateViewConfig (strict) is still used when SAVING a config.
export function sanitizeViewConfig(
  fields: MxdField[],
  config: ViewConfig | undefined | null,
): ViewConfig {
  if (config == null) return {};
  const ids = new Set(fields.map((f) => f.id));
  const byId = new Map(fields.map((f) => [f.id, f]));
  const pruneGroup = (g: FilterGroup): FilterGroup => ({
    combinator: g.combinator === 'or' ? 'or' : 'and',
    conditions: (g.conditions ?? [])
      .map((n) =>
        isGroup(n)
          ? pruneGroup(n)
          : ids.has(n.fieldId) &&
              getFieldType(byId.get(n.fieldId)!.type).filterOperators.includes(
                n.op,
              )
            ? n
            : null,
      )
      .filter((n): n is FilterCondition | FilterGroup => {
        if (n == null) return false;
        if (isGroup(n)) return n.conditions.length > 0;
        return true;
      }),
  });
  return {
    visibleFields: (config.visibleFields ?? []).filter((f) => ids.has(f)),
    fieldOrder: (config.fieldOrder ?? []).filter((f) => ids.has(f)),
    sorts: (config.sorts ?? []).filter(
      (s) => ids.has(s.fieldId) && (s.direction === 'asc' || s.direction === 'desc'),
    ),
    filter: config.filter ? pruneGroup(config.filter) : undefined,
    groupByFieldId:
      config.groupByFieldId && ids.has(config.groupByFieldId)
        ? config.groupByFieldId
        : undefined,
    displayFieldId:
      config.displayFieldId && ids.has(config.displayFieldId)
        ? config.displayFieldId
        : undefined,
  };
}

// Validate + normalize a view config against the table's fields. Throws
// BadRequestException on any unknown field id, illegal operator for the field
// type, or over-complex filter. Returns the config unchanged when valid.
export function validateViewConfig(
  fields: MxdField[],
  config: ViewConfig | undefined | null,
): ViewConfig {
  if (config == null) return {};
  const byId = new Map(fields.map((f) => [f.id, f]));
  const requireField = (fieldId: string, where: string): MxdField => {
    const f = byId.get(fieldId);
    if (!f) {
      throw new BadRequestException(
        `${where} references a field not on this table: ${fieldId}`,
      );
    }
    return f;
  };

  for (const fieldId of config.visibleFields ?? [])
    requireField(fieldId, 'visibleFields');
  for (const fieldId of config.fieldOrder ?? [])
    requireField(fieldId, 'fieldOrder');
  if (config.displayFieldId)
    requireField(config.displayFieldId, 'displayFieldId');
  if (config.groupByFieldId)
    requireField(config.groupByFieldId, 'groupByFieldId');

  const sorts = config.sorts ?? [];
  if (sorts.length > MAX_SORTS) {
    throw new BadRequestException(`Too many sorts (max ${MAX_SORTS})`);
  }
  for (const s of sorts) {
    requireField(s.fieldId, 'sort');
    if (s.direction !== 'asc' && s.direction !== 'desc') {
      throw new BadRequestException(`Invalid sort direction: ${s.direction}`);
    }
  }

  let conditionCount = 0;
  const walk = (node: FilterCondition | FilterGroup, depth: number): void => {
    if (depth > MAX_FILTER_DEPTH) {
      throw new BadRequestException(
        `Filter nested too deeply (max ${MAX_FILTER_DEPTH})`,
      );
    }
    if (isGroup(node)) {
      if (node.combinator !== 'and' && node.combinator !== 'or') {
        throw new BadRequestException(
          `Invalid filter combinator: ${node.combinator}`,
        );
      }
      if (!Array.isArray(node.conditions)) {
        throw new BadRequestException('Filter group is missing conditions');
      }
      for (const child of node.conditions) walk(child, depth + 1);
    } else {
      if (++conditionCount > MAX_FILTER_CONDITIONS) {
        throw new BadRequestException(
          `Too many filter conditions (max ${MAX_FILTER_CONDITIONS})`,
        );
      }
      const field = requireField(node.fieldId, 'filter');
      const allowed = getFieldType(field.type).filterOperators;
      if (!allowed.includes(node.op)) {
        throw new BadRequestException(
          `Operator "${node.op}" is not valid for field "${field.name}"`,
        );
      }
      if (
        typeof node.value === 'string' &&
        node.value.length > MAX_VALUE_LEN
      ) {
        throw new BadRequestException('Filter value is too long');
      }
    }
  };
  if (config.filter) walk(config.filter, 1);

  return config;
}
