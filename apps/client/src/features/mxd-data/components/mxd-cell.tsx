import { useState } from "react";
import {
  Anchor,
  Badge,
  Checkbox,
  Group,
  MultiSelect,
  Select,
  Text,
  TextInput,
} from "@mantine/core";
import { MxdField } from "../mxd-data.api";
import { fieldTypeMeta, renderCellText } from "../mxd-field-types";

interface Choice {
  id: string;
  label: string;
  color?: string;
}

interface MxdCellProps {
  field: MxdField;
  value: unknown;
  editing: boolean;
  readOnly?: boolean;
  onStartEdit: () => void;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}

function getChoices(field: MxdField): Choice[] {
  return (field.config?.choices as Choice[]) ?? [];
}
function choiceById(field: MxdField): Map<string, Choice> {
  return new Map(getChoices(field).map((c) => [c.id, c]));
}

// A single grid cell. Settable types render an inline editor when `editing`;
// computed/relation/button types are always read-only display; checkboxes toggle
// on a single click. Select/multi-select display their choice LABELS (with color)
// rather than the stored ids. The server is the source of truth for validation.
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

function ChoiceBadge({ choice }: { choice: Choice }) {
  return (
    <Badge size="sm" variant="light" color={choice.color ?? "gray"} radius="sm">
      {choice.label}
    </Badge>
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

  if (meta.input === "select") {
    const c = choiceById(field).get(value as string);
    return (
      <div onClick={onStartEdit} style={{ cursor: "pointer", minHeight: 20 }}>
        {c ? <ChoiceBadge choice={c} /> : <EmptyDash />}
      </div>
    );
  }

  if (meta.input === "multiSelect") {
    const byId = choiceById(field);
    const ids = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Group
        gap={4}
        wrap="wrap"
        onClick={onStartEdit}
        style={{ cursor: "pointer", minHeight: 20 }}
      >
        {ids.length === 0 && <EmptyDash />}
        {ids.map((id) => {
          const c = byId.get(id);
          return c ? <ChoiceBadge key={id} choice={c} /> : null;
        })}
      </Group>
    );
  }

  const text = renderCellText(value);
  if ((meta.input === "url" || meta.input === "email") && text) {
    const href = meta.input === "email" ? `mailto:${text}` : text;
    return (
      <Anchor
        href={href}
        target="_blank"
        size="sm"
        truncate
        onClick={(e) => e.stopPropagation()}
      >
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
      {text || <EmptyDash />}
    </Text>
  );
}

function EmptyDash() {
  return <span style={{ color: "var(--mantine-color-dimmed)" }}>—</span>;
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
    const data = getChoices(field).map((c) => ({ value: c.id, label: c.label }));
    return (
      <Select
        size="xs"
        autoFocus
        searchable
        clearable
        defaultValue={typeof value === "string" ? value : null}
        data={data}
        onChange={(v) => onCommit(v ?? null)}
        onBlur={onCancel}
        comboboxProps={{ withinPortal: true }}
      />
    );
  }

  if (meta.input === "multiSelect") {
    return <MultiSelectEditor field={field} value={value} onCommit={onCommit} />;
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

function MultiSelectEditor({
  field,
  value,
  onCommit,
}: {
  field: MxdField;
  value: unknown;
  onCommit: (v: unknown) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    Array.isArray(value) ? (value as string[]) : [],
  );
  const data = getChoices(field).map((c) => ({ value: c.id, label: c.label }));
  return (
    <MultiSelect
      size="xs"
      autoFocus
      searchable
      clearable
      data={data}
      value={selected}
      onChange={setSelected}
      onBlur={() => onCommit(selected)}
      onDropdownClose={() => onCommit(selected)}
      comboboxProps={{ withinPortal: true }}
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
