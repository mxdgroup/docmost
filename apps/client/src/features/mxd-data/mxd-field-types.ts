// MXD data platform — client-side field-type classification. Mirrors the server
// field-type registry (apps/server/.../field-types.registry.ts): which types are
// computed (read-only, derived on read), which are relations (edited via the
// relation endpoints), and what input control a settable cell should render.
// The server remains the source of truth for validation — this only drives UI.

export type MxdInputKind =
  | "text"
  | "longText"
  | "number"
  | "checkbox"
  | "date"
  | "datetime"
  | "select"
  | "multiSelect"
  | "url"
  | "email"
  | "user"
  | "none"; // computed / relation / button — not a directly-typed cell

export interface MxdFieldTypeMeta {
  key: string;
  label: string;
  input: MxdInputKind;
  computed: boolean;
  relation: boolean;
  button: boolean;
}

const T = (
  key: string,
  label: string,
  input: MxdInputKind,
  extra: Partial<MxdFieldTypeMeta> = {},
): MxdFieldTypeMeta => ({
  key,
  label,
  input,
  computed: false,
  relation: false,
  button: false,
  ...extra,
});

export const MXD_FIELD_TYPES: MxdFieldTypeMeta[] = [
  T("text", "Text", "text"),
  T("long_text", "Long text", "longText"),
  T("number", "Number", "number"),
  T("currency", "Currency", "number"),
  T("percent", "Percent", "number"),
  T("checkbox", "Checkbox", "checkbox"),
  T("date", "Date", "date"),
  T("datetime", "Date & time", "datetime"),
  T("select", "Single select", "select"),
  T("multi_select", "Multi select", "multiSelect"),
  T("url", "URL", "url"),
  T("email", "Email", "email"),
  T("user", "User", "user"),
  // relation
  T("relation", "Relation", "none", { relation: true }),
  // button
  T("button", "Button", "none", { button: true }),
  // computed (read-only)
  T("formula", "Formula", "none", { computed: true }),
  T("lookup", "Lookup", "none", { computed: true }),
  T("rollup", "Rollup", "none", { computed: true }),
  T("created_time", "Created time", "none", { computed: true }),
  T("updated_time", "Updated time", "none", { computed: true }),
  T("created_by", "Created by", "none", { computed: true }),
  T("updated_by", "Updated by", "none", { computed: true }),
  T("autonumber", "Auto number", "none", { computed: true }),
];

const BY_KEY = new Map(MXD_FIELD_TYPES.map((t) => [t.key, t]));

export function fieldTypeMeta(type: string): MxdFieldTypeMeta {
  return BY_KEY.get(type) ?? T(type, type, "text");
}

// The field types a user can pick when adding a plain (settable) column. Computed
// and relation types need extra config, so they're offered through dedicated
// flows, not the generic "add column" type list.
export const MXD_SETTABLE_FIELD_TYPES = MXD_FIELD_TYPES.filter(
  (t) => !t.computed && !t.relation && !t.button,
);

// Render a stored cell value as display text (matches CSV export semantics).
export function renderCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("error" in obj) return `#ERROR`;
    return JSON.stringify(value);
  }
  return String(value);
}
