import { useState } from "react";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { MXD_SETTABLE_FIELD_TYPES } from "../mxd-field-types";
import {
  useMxdFieldMutations,
  useMxdTable,
  useMxdTables,
} from "../queries/mxd-data-query";
import {
  MxdFieldConfigEditor,
  isComputedConfigValid,
} from "./mxd-field-config-editor";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

// Computed / derived types that carry their own config (edited via the config
// editor). Relation is handled separately (it only needs a target table).
const COMPUTED_TYPES = [
  { value: "formula", label: "Formula" },
  { value: "lookup", label: "Lookup" },
  { value: "rollup", label: "Rollup" },
  { value: "button", label: "Button" },
];
const isComputed = (t: string) =>
  COMPUTED_TYPES.some((c) => c.value === t);

// Add a column: settable types, Relation (needs a target table), or a computed
// type (formula / lookup / rollup) with its config.
export function MxdAddColumnModal({ tableId, opened, onClose }: Props) {
  const { add } = useMxdFieldMutations(tableId);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("text");
  const [relatedTableId, setRelatedTableId] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, any>>({});

  const table = useMxdTable(tableId);
  const spaceId = table.data?.spaceId ?? "";
  const tables = useMxdTables(spaceId, opened && type === "relation");

  const typeOptions = [
    ...MXD_SETTABLE_FIELD_TYPES.map((t) => ({ value: t.key, label: t.label })),
    { value: "relation", label: "Relation" },
    ...COMPUTED_TYPES,
  ];

  const reset = () => {
    setName("");
    setType("text");
    setRelatedTableId(null);
    setConfig({});
  };

  const canSubmit =
    !!name.trim() &&
    (type !== "relation" || !!relatedTableId) &&
    (!isComputed(type) || isComputedConfigValid(type, config));

  const submit = async () => {
    if (!canSubmit) return;
    await add.mutateAsync({
      name: name.trim(),
      type,
      config:
        type === "relation"
          ? { relatedTableId, single: false }
          : isComputed(type)
            ? config
            : undefined,
    });
    reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add column" size="md" centered>
      <Stack>
        <TextInput
          label="Name"
          placeholder="Column name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => e.key === "Enter" && !isComputed(type) && submit()}
        />
        <Select
          label="Type"
          value={type}
          onChange={(v) => {
            setType(v ?? "text");
            setConfig({});
            setRelatedTableId(null);
          }}
          data={typeOptions}
          comboboxProps={{ withinPortal: true }}
          maxDropdownHeight={280}
        />
        {type === "relation" && (
          <Select
            label="Related table"
            placeholder={tables.isLoading ? "Loading…" : "Pick a table"}
            value={relatedTableId}
            onChange={(v) => setRelatedTableId(v)}
            data={(tables.data ?? [])
              .filter((t) => t.id !== tableId)
              .map((t) => ({ value: t.id, label: t.title || "Untitled table" }))}
            searchable
            nothingFoundMessage="No other tables in this space"
            comboboxProps={{ withinPortal: true }}
          />
        )}
        {isComputed(type) && (
          <MxdFieldConfigEditor
            tableId={tableId}
            type={type}
            config={config}
            onChange={setConfig}
          />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending} disabled={!canSubmit}>
            Add column
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
