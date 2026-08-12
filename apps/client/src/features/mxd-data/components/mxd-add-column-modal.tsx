import { useState } from "react";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { MXD_SETTABLE_FIELD_TYPES } from "../mxd-field-types";
import {
  useMxdFieldMutations,
  useMxdTable,
  useMxdTables,
} from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

// Add a column. Settable types plus Relation (which needs a target table).
// Computed columns (formula/lookup/rollup) are added through their own flow.
export function MxdAddColumnModal({ tableId, opened, onClose }: Props) {
  const { add } = useMxdFieldMutations(tableId);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("text");
  const [relatedTableId, setRelatedTableId] = useState<string | null>(null);

  const table = useMxdTable(tableId);
  const spaceId = table.data?.spaceId ?? "";
  const tables = useMxdTables(spaceId, opened && type === "relation");

  const typeOptions = [
    ...MXD_SETTABLE_FIELD_TYPES.map((t) => ({ value: t.key, label: t.label })),
    { value: "relation", label: "Relation" },
  ];

  const reset = () => {
    setName("");
    setType("text");
    setRelatedTableId(null);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (type === "relation" && !relatedTableId) return;
    await add.mutateAsync({
      name: trimmed,
      type,
      config:
        type === "relation" ? { relatedTableId, single: false } : undefined,
    });
    reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Add column" size="sm" centered>
      <Stack>
        <TextInput
          label="Name"
          placeholder="Column name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <Select
          label="Type"
          value={type}
          onChange={(v) => setType(v ?? "text")}
          data={typeOptions}
          comboboxProps={{ withinPortal: true }}
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
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={add.isPending}
            disabled={
              !name.trim() || (type === "relation" && !relatedTableId)
            }
          >
            Add column
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
