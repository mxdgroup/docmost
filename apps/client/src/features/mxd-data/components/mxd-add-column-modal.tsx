import { useState } from "react";
import { Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { MXD_SETTABLE_FIELD_TYPES } from "../mxd-field-types";
import { useMxdFieldMutations } from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

// Add a plain (settable) column. Computed/relation columns need extra config and
// are added through their own flows, so only settable types are offered here.
export function MxdAddColumnModal({ tableId, opened, onClose }: Props) {
  const { add } = useMxdFieldMutations(tableId);
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("text");

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await add.mutateAsync({ name: trimmed, type });
    setName("");
    setType("text");
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
          data={MXD_SETTABLE_FIELD_TYPES.map((t) => ({
            value: t.key,
            label: t.label,
          }))}
          comboboxProps={{ withinPortal: true }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending} disabled={!name.trim()}>
            Add column
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
