// MXD data platform — field-type contract (roadmap §6). One central registry so
// type behaviour is never scattered across controllers and React components.
//
// A field's `type` is a stable string key into this registry. The registry entry
// owns everything the server needs to treat a cell safely: how to validate a
// write, how to normalize it into the stored jsonb value, which filter operators
// are legal, and whether the type is computed (read-only) or a relation (stored
// as edges, not a jsonb cell).

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'on'
  | 'isTrue'
  | 'isFalse'
  | 'is'
  | 'isNot'
  | 'hasAny'
  | 'hasAll'
  | 'hasNone';

export class FieldValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldValidationError';
  }
}

// Per-field configuration (the `config` jsonb on mxd_fields). Only the keys a
// given type reads are meaningful; unknown keys are ignored.
export interface FieldConfig {
  // select / multi_select
  choices?: { id: string; label: string }[];
  // number / currency / percent
  precision?: number;
  // relation
  relatedTableId?: string;
  reciprocalFieldId?: string;
  single?: boolean; // one-to-* when true
  // lookup / rollup
  viaFieldId?: string;
  targetFieldId?: string;
  rollup?: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'concat';
  // formula
  expression?: string;
  [key: string]: unknown;
}

export interface FieldType {
  key: string;
  // A relation is stored as edges in mxd_record_links, not as a jsonb cell.
  isRelation?: boolean;
  // Computed cells are derived by the compute service and are read-only to
  // clients (formula/lookup/rollup/created_time/updated_time/created_by/
  // updated_by/autonumber).
  isComputed?: boolean;
  // Legal filter operators for this type.
  filterOperators: FilterOperator[];
  // Validate + normalize a client-supplied cell value into its stored form.
  // Throws FieldValidationError on invalid input. `null`/`undefined` clears the
  // cell (returns null). Not called for relation/computed types.
  normalize(value: unknown, config: FieldConfig): unknown;
}
