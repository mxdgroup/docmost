import { useEffect, useRef, useState } from "react";
import {
  Checkbox,
  Select,
  Text,
  TextInput,
  Tooltip,
  Anchor,
} from "@mantine/core";
import { MxdField } from "../mxd-data.api";
import { fieldTypeMeta, renderCellText } from "../mxd-field-types";

interface MxdCellProps {
  field: MxdField;
  value: unknown;
  editing: boolean;
  readOnly?: boolean;
  onStartEdit: () => void;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}

// A single grid cell. Settable types render an inline editor when `editing`;
// computed/relation/button types are always read-only display; checkboxes toggle
// on a single click. The server is the source of truth for validation — this only
// coerces the obvious cases (number, checkbox, date) so a valid value round-trips.
export function MxdCell({
  field,
  value,
  editing,
  readOnly,
  onStartEdit,
  onCommit,
  onCancel,
}: MxdCellProps) {
  const meta = fieldTypeMeta(field.type);
  const locked = readOnly || meta.computed || meta.relation || meta.button;

  // Read-only cell types: computed values, relation summaries, buttons.
  if (locked) {
    return (
      <Text size="sm" c="dimmed" truncate style={{ userSelect: "text" }}>
        {meta.button ? "" : renderCellText(value)}
      </Text>
    );
  }

  // Checkbox toggles directly — no separate edit mode.
  if (meta.input === "checkbox") {
    return (
      <Checkbox
        size="sm"
        checked={!!value}
        onChange={(e) => onCommit(e.currentTarget.checked)}
        styles={{ input: { cursor: "pointer" } }}
      />
    );
  }

  if (!editing) {
    return <MxdCellDisplay field={field} value={value} onStartEdit={onStartEdit} />;
  }

  return (
    <MxdCellEditor
      field={field}
      value={value}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

function MxdCellDisplay({
  field,
  value,
  onStartEdit,
}: {
  field: MxdField;
  value: unknown;
  onStartEdit: () => void;
}) {
  const meta = fieldTypeMeta(field.type);

  const text = renderCellText(value);
  if ((meta.input === "url" || meta.input === "email") && text) {
    const href = meta.input === "email" ? `mailto:${text}` : text;
    return (
      <Anchor href={href} target="_blank" size="sm" truncate onClick={(e) => e.stopPropagation()}>
        {text}
      </Anchor>
    );
  }

  return (
    <Text
      size="sm"
      truncate
      onClick={onStartEdit}
      style={{ cursor: "text", minHeight: 20, width: "100%" }}
    >
      {text || <span style={{ color: "var(--mantine-color-dimmed)" }}>—</span>}
    </Text>
  );
}

function MxdCellEditor({
  field,
  value,
  onCommit,
  onCancel,
}: {
  field: MxdField;
  value: unknown;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const meta = fieldTypeMeta(field.type);

  if (meta.input === "select") {
    const options: { id: string; label?: string }[] = field.config?.options ?? [];
    return (
      <Select
        size="xs"
        autoFocus
        searchable
        clearable
        defaultValue={typeof value === "string" ? value : null}
        data={options.map((o) => ({ value: o.id, label: o.label ?? o.id }))}
        onChange={(v) => onCommit(v ?? null)}
        onBlur={onCancel}
        comboboxProps={{ withinPortal: true }}
      />
    );
  }

  // date / datetime via native inputs — reliable YYYY-MM-DD / ISO serialization
  if (meta.input === "date" || meta.input === "datetime") {
    const isDate = meta.input === "date";
    const initial = typeof value === "string" ? value : "";
    return (
      <input
        type={isDate ? "date" : "datetime-local"}
        autoFocus
        defaultValue={isDate ? initial.slice(0, 10) : toLocalInput(initial)}
        onBlur={(e) => {
          const raw = e.currentTarget.value;
          if (!raw) return onCommit(null);
          onCommit(isDate ? raw : new Date(raw).toISOString());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") onCancel();
        }}
        style={{ width: "100%", border: "none", outline: "none", font: "inherit" }}
      />
    );
  }

  // text-like default (text, long_text, number, url, email, user)
  const asNumber = meta.input === "number";
  return (
    <TextInput
      size="xs"
      autoFocus
      variant="unstyled"
      type={asNumber ? "number" : "text"}
      defaultValue={value == null ? "" : String(value)}
      onBlur={(e) => commitText(e.currentTarget.value, asNumber, onCommit)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}

function commitText(
  raw: string,
  asNumber: boolean,
  onCommit: (v: unknown) => void,
) {
  if (raw === "") return onCommit(null);
  if (asNumber) {
    const n = Number(raw);
    return onCommit(Number.isFinite(n) ? n : raw);
  }
  onCommit(raw);
}

// Convert a stored ISO string to the value a datetime-local input expects.
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
