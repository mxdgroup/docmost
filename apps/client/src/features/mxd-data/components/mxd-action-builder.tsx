import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { MxdField } from "../mxd-data.api";
import { fieldTypeMeta } from "../mxd-field-types";
import { useMxdFields } from "../queries/mxd-data-query";

// A declarative action (matches the server ButtonAction union). createRecord is
// intentionally not offered in this builder yet — it needs a full cell editor;
// the other four cover the common button/automation cases.
export type MxdAction =
  | { type: "setField"; fieldId: string; value: unknown }
  | { type: "clearField"; fieldId: string }
  | { type: "setNow"; fieldId: string }
  | { type: "openUrl"; url: string };

interface Props {
  tableId: string;
  actions: MxdAction[];
  onChange: (actions: MxdAction[]) => void;
  allowOpenUrl?: boolean; // buttons: yes; automations: no (runs server-side)
}

// Shared action-list editor for buttons and automations. Type-aware setField
// value input (checkbox / select / text). The server re-validates every action.
export function MxdActionBuilder({
  tableId,
  actions,
  onChange,
  allowOpenUrl = false,
}: Props) {
  const fields = useMxdFields(tableId).data ?? [];
  const settable = fields.filter((f) => {
    const m = fieldTypeMeta(f.type);
    return !m.computed && !m.relation && !m.button;
  });

  const typeData = [
    { value: "setField", label: "Set a field" },
    { value: "clearField", label: "Clear a field" },
    { value: "setNow", label: "Set to now (date)" },
    ...(allowOpenUrl ? [{ value: "openUrl", label: "Open a URL" }] : []),
  ];

  const update = (i: number, next: MxdAction) =>
    onChange(actions.map((a, idx) => (idx === i ? next : a)));
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([
      ...actions,
      { type: "setField", fieldId: settable[0]?.id ?? "", value: "" },
    ]);

  const changeType = (i: number, type: string) => {
    const fid = settable[0]?.id ?? "";
    if (type === "openUrl") update(i, { type: "openUrl", url: "" });
    else if (type === "clearField") update(i, { type: "clearField", fieldId: fid });
    else if (type === "setNow") update(i, { type: "setNow", fieldId: fid });
    else update(i, { type: "setField", fieldId: fid, value: "" });
  };

  return (
    <Stack gap={8}>
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          Actions
        </Text>
        <Button
          size="compact-xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={add}
        >
          Add action
        </Button>
      </Group>
      {actions.length === 0 && (
        <Text size="xs" c="dimmed">
          No actions yet.
        </Text>
      )}
      {actions.map((action, i) => (
        <Group key={i} gap={6} wrap="nowrap" align="flex-start">
          <Select
            size="xs"
            w={140}
            value={action.type}
            data={typeData}
            onChange={(v) => v && changeType(i, v)}
            comboboxProps={{ withinPortal: true }}
          />
          {action.type === "openUrl" ? (
            <TextInput
              size="xs"
              style={{ flex: 1 }}
              placeholder="https://…"
              value={action.url}
              onChange={(e) =>
                update(i, { type: "openUrl", url: e.currentTarget.value })
              }
            />
          ) : (
            <>
              <Select
                size="xs"
                w={140}
                placeholder="Field"
                value={"fieldId" in action ? action.fieldId : null}
                data={settable.map((f) => ({ value: f.id, label: f.name }))}
                onChange={(fid) =>
                  fid && update(i, { ...action, fieldId: fid } as MxdAction)
                }
                comboboxProps={{ withinPortal: true }}
              />
              {action.type === "setField" && (
                <SetFieldValue
                  field={settable.find((f) => f.id === action.fieldId)}
                  value={action.value}
                  onChange={(value) =>
                    update(i, { type: "setField", fieldId: action.fieldId, value })
                  }
                />
              )}
            </>
          )}
          <ActionIcon
            size="sm"
            variant="subtle"
            color="red"
            aria-label="Remove action"
            onClick={() => remove(i)}
          >
            <IconTrash size={15} />
          </ActionIcon>
        </Group>
      ))}
    </Stack>
  );
}

function SetFieldValue({
  field,
  value,
  onChange,
}: {
  field?: MxdField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (!field) return <div style={{ flex: 1 }} />;
  const meta = fieldTypeMeta(field.type);

  if (meta.input === "checkbox") {
    return (
      <Checkbox
        checked={!!value}
        onChange={(e) => onChange(e.currentTarget.checked)}
        mt={4}
      />
    );
  }
  if (meta.input === "select") {
    const choices: { id: string; label: string }[] = field.config?.choices ?? [];
    return (
      <Select
        size="xs"
        style={{ flex: 1 }}
        placeholder="Value"
        value={typeof value === "string" ? value : null}
        data={choices.map((c) => ({ value: c.id, label: c.label }))}
        onChange={(v) => onChange(v)}
        comboboxProps={{ withinPortal: true }}
      />
    );
  }
  return (
    <TextInput
      size="xs"
      style={{ flex: 1 }}
      placeholder="Value"
      value={value == null ? "" : String(value)}
      onChange={(e) => {
        const raw = e.currentTarget.value;
        onChange(meta.input === "number" && raw !== "" ? Number(raw) : raw);
      }}
    />
  );
}
