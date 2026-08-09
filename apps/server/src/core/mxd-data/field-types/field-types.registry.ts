import {
  FieldConfig,
  FieldType,
  FieldValidationError,
  FilterOperator,
} from './field-type';

const TEXT_MAX = 10_000;
const LONG_TEXT_MAX = 100_000;

const TEXT_OPS: FilterOperator[] = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'isEmpty',
  'isNotEmpty',
];
const NUMBER_OPS: FilterOperator[] = [
  'equals',
  'notEquals',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isEmpty',
  'isNotEmpty',
];
const DATE_OPS: FilterOperator[] = [
  'before',
  'after',
  'on',
  'between',
  'isEmpty',
  'isNotEmpty',
];
const SELECT_OPS: FilterOperator[] = ['is', 'isNot', 'isEmpty', 'isNotEmpty'];
const MULTI_OPS: FilterOperator[] = [
  'hasAny',
  'hasAll',
  'hasNone',
  'isEmpty',
  'isNotEmpty',
];

function asString(value: unknown, max: number, label: string): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    value = String(value);
  }
  if (typeof value !== 'string') {
    throw new FieldValidationError(`${label} expects text`);
  }
  if (value.length > max) {
    throw new FieldValidationError(`${label} exceeds ${max} characters`);
  }
  return value;
}

function asNumber(value: unknown, config: FieldConfig, label: string): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new FieldValidationError(`${label} expects a number`);
  }
  if (typeof config.precision === 'number' && config.precision >= 0) {
    const f = 10 ** config.precision;
    return Math.round(n * f) / f;
  }
  return n;
}

function nullish(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

const text: FieldType = {
  key: 'text',
  filterOperators: TEXT_OPS,
  normalize: (v) => (nullish(v) ? null : asString(v, TEXT_MAX, 'text')),
};

const longText: FieldType = {
  key: 'long_text',
  filterOperators: TEXT_OPS,
  normalize: (v) =>
    nullish(v) ? null : asString(v, LONG_TEXT_MAX, 'long_text'),
};

const number: FieldType = {
  key: 'number',
  filterOperators: NUMBER_OPS,
  normalize: (v, c) => (nullish(v) ? null : asNumber(v, c, 'number')),
};

const currency: FieldType = {
  key: 'currency',
  filterOperators: NUMBER_OPS,
  normalize: (v, c) => (nullish(v) ? null : asNumber(v, c, 'currency')),
};

const percent: FieldType = {
  key: 'percent',
  filterOperators: NUMBER_OPS,
  normalize: (v, c) => (nullish(v) ? null : asNumber(v, c, 'percent')),
};

const checkbox: FieldType = {
  key: 'checkbox',
  filterOperators: ['isTrue', 'isFalse'],
  normalize: (v) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === 1) return true;
    if (v === 'false' || v === 0) return false;
    throw new FieldValidationError('checkbox expects a boolean');
  },
};

const dateOnly: FieldType = {
  key: 'date',
  filterOperators: DATE_OPS,
  normalize: (v) => {
    if (nullish(v)) return null;
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new FieldValidationError('date expects YYYY-MM-DD');
    }
    if (Number.isNaN(Date.parse(v))) {
      throw new FieldValidationError('date is not a valid calendar date');
    }
    return v;
  },
};

const dateTime: FieldType = {
  key: 'datetime',
  filterOperators: DATE_OPS,
  normalize: (v) => {
    if (nullish(v)) return null;
    if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
      throw new FieldValidationError('datetime expects an ISO timestamp');
    }
    return new Date(v).toISOString();
  },
};

const select: FieldType = {
  key: 'select',
  filterOperators: SELECT_OPS,
  normalize: (v, c) => {
    if (nullish(v)) return null;
    const ids = new Set((c.choices ?? []).map((o) => o.id));
    if (typeof v !== 'string' || !ids.has(v)) {
      throw new FieldValidationError('select value is not an allowed choice');
    }
    return v;
  },
};

const multiSelect: FieldType = {
  key: 'multi_select',
  filterOperators: MULTI_OPS,
  normalize: (v, c) => {
    if (nullish(v)) return [];
    if (!Array.isArray(v)) {
      throw new FieldValidationError('multi_select expects an array');
    }
    const ids = new Set((c.choices ?? []).map((o) => o.id));
    const out: string[] = [];
    for (const item of v) {
      if (typeof item !== 'string' || !ids.has(item)) {
        throw new FieldValidationError(
          'multi_select contains a value that is not an allowed choice',
        );
      }
      if (!out.includes(item)) out.push(item); // dedup
    }
    return out;
  },
};

const url: FieldType = {
  key: 'url',
  filterOperators: TEXT_OPS,
  normalize: (v) => {
    if (nullish(v)) return null;
    const s = asString(v, TEXT_MAX, 'url').trim();
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      throw new FieldValidationError('url is not a valid URL');
    }
    // Reject dangerous schemes (XSS, roadmap §26). Only web/mail links.
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      throw new FieldValidationError('url scheme is not allowed');
    }
    return parsed.toString();
  },
};

const email: FieldType = {
  key: 'email',
  filterOperators: TEXT_OPS,
  normalize: (v) => {
    if (nullish(v)) return null;
    const s = asString(v, 320, 'email').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      throw new FieldValidationError('email is not valid');
    }
    return s;
  },
};

const user: FieldType = {
  key: 'user',
  filterOperators: SELECT_OPS,
  normalize: (v) => {
    if (nullish(v)) return null;
    // Shape check only — the service confirms the user is a workspace member.
    if (
      typeof v !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ) {
      throw new FieldValidationError('user expects a user id');
    }
    return v;
  },
};

// Relation: stored as edges in mxd_record_links, never a jsonb cell. A direct
// cell write is refused; linking goes through the relation API.
const relation: FieldType = {
  key: 'relation',
  isRelation: true,
  filterOperators: ['isEmpty', 'isNotEmpty'],
  normalize: () => {
    throw new FieldValidationError(
      'relation values are set via the relation endpoints, not a cell write',
    );
  },
};

// Computed types: derived server-side, read-only to clients. A direct write is
// refused; the compute service populates the cell.
function computed(key: string, ops: FilterOperator[]): FieldType {
  return {
    key,
    isComputed: true,
    filterOperators: ops,
    normalize: () => {
      throw new FieldValidationError(`${key} is computed and cannot be set`);
    },
  };
}

const REGISTRY: Record<string, FieldType> = Object.freeze({
  text,
  long_text: longText,
  number,
  currency,
  percent,
  checkbox,
  date: dateOnly,
  datetime: dateTime,
  select,
  multi_select: multiSelect,
  url,
  email,
  user,
  relation,
  lookup: computed('lookup', [...NUMBER_OPS, ...TEXT_OPS]),
  rollup: computed('rollup', NUMBER_OPS),
  formula: computed('formula', [...NUMBER_OPS, ...TEXT_OPS]),
  created_time: computed('created_time', DATE_OPS),
  updated_time: computed('updated_time', DATE_OPS),
  created_by: computed('created_by', SELECT_OPS),
  updated_by: computed('updated_by', SELECT_OPS),
  autonumber: computed('autonumber', NUMBER_OPS),
});

export function getFieldType(type: string): FieldType {
  const t = REGISTRY[type];
  if (!t) throw new FieldValidationError(`unknown field type: ${type}`);
  return t;
}

export function isKnownFieldType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

export function listFieldTypes(): string[] {
  return Object.keys(REGISTRY);
}

export { REGISTRY as MXD_FIELD_TYPES };
