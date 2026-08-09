import { useState } from "react";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MxdField,
  MxdRecord,
  mxdCreateRecord,
  mxdCreateTable,
  mxdListFields,
  mxdListRecords,
  mxdUpdateRecord,
} from "@/features/mxd-data/mxd-data.api.ts";

// MXD data platform — the mxdTable NodeView (roadmap §16/§20). Renders the
// relational grid referenced by node.attrs.tableId, fetched through the /mxd
// API. Row data is never read from the ProseMirror document. Editing is disabled
// when the editor is read-only (e.g. a view-mode public share).
export default function MxdTableView(props: NodeViewProps) {
  const tableId: string | null = props.node.attrs.tableId ?? null;
  const editable = props.editor.isEditable;
  const queryClient = useQueryClient();

  const fieldsQuery = useQuery<MxdField[]>({
    queryKey: ["mxd-fields", tableId],
    queryFn: () => mxdListFields(tableId as string),
    enabled: !!tableId,
  });
  const recordsQuery = useQuery({
    queryKey: ["mxd-records", tableId],
    queryFn: () => mxdListRecords(tableId as string, { limit: 100 }),
    enabled: !!tableId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["mxd-records", tableId] });
  };

  const commitCell = async (
    record: MxdRecord,
    fieldId: string,
    value: unknown,
  ) => {
    try {
      await mxdUpdateRecord({
        tableId: tableId as string,
        recordId: record.id,
        version: record.version,
        cells: { [fieldId]: value },
      });
      refresh();
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 409) {
        notifications.show({
          color: "yellow",
          message: "This record changed elsewhere — reloading latest.",
        });
        refresh();
      } else {
        notifications.show({
          color: "red",
          message: err?.response?.data?.message ?? "Could not save the change",
        });
      }
    }
  };

  const addRow = async () => {
    try {
      await mxdCreateRecord(tableId as string, {});
      refresh();
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? "Could not add a row",
      });
    }
  };

  if (!tableId) {
    const pageId: string | undefined = (props.editor.storage as any).pageId;
    const createTable = async () => {
      if (!pageId) return;
      try {
        const table = await mxdCreateTable({ pageId, title: "Table" });
        // Store ONLY the reference on the node — the table lives in mxd_*.
        props.updateAttributes({ tableId: table.id, viewId: null });
      } catch (err: any) {
        notifications.show({
          color: "red",
          message: err?.response?.data?.message ?? "Could not create the table",
        });
      }
    };
    return (
      <NodeViewWrapper>
        <Alert color="gray" variant="light">
          <Group justify="space-between">
            <Text size="sm">This table block isn’t linked to a table yet.</Text>
            {editable && pageId && (
              <Button size="compact-xs" onClick={createTable}>
                Create table
              </Button>
            )}
          </Group>
        </Alert>
      </NodeViewWrapper>
    );
  }

  if (fieldsQuery.isLoading || recordsQuery.isLoading) {
    return (
      <NodeViewWrapper>
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      </NodeViewWrapper>
    );
  }

  if (fieldsQuery.isError || recordsQuery.isError) {
    return (
      <NodeViewWrapper>
        <Alert color="red" variant="light">
          <Text size="sm">This table couldn’t be loaded.</Text>
        </Alert>
      </NodeViewWrapper>
    );
  }

  const fields = fieldsQuery.data ?? [];
  const records = recordsQuery.data?.items ?? [];

  return (
    <NodeViewWrapper>
      <div style={{ overflowX: "auto", border: "1px solid var(--mantine-color-default-border)", borderRadius: 6 }}>
        <Table striped withColumnBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              {fields.map((f) => (
                <Table.Th key={f.id}>{f.name}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {records.map((record) => (
              <Table.Tr key={record.id}>
                {fields.map((f) => (
                  <Table.Td key={f.id}>
                    <MxdCell
                      field={f}
                      record={record}
                      editable={editable}
                      onCommit={(value) => commitCell(record, f.id, value)}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
            {records.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={Math.max(1, fields.length)}>
                  <Text size="sm" c="dimmed" ta="center">
                    No rows yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </div>
      {editable && (
        <Group mt="xs">
          <Button size="compact-xs" variant="light" onClick={addRow}>
            + Add row
          </Button>
          {recordsQuery.data && (
            <Text size="xs" c="dimmed">
              {recordsQuery.data.total} row(s)
            </Text>
          )}
        </Group>
      )}
    </NodeViewWrapper>
  );
}

function MxdCell({
  field,
  record,
  editable,
  onCommit,
}: {
  field: MxdField;
  record: MxdRecord;
  editable: boolean;
  onCommit: (value: unknown) => void;
}) {
  const stored = record.data?.[field.id];

  if (field.type === "checkbox") {
    return (
      <Checkbox
        size="xs"
        checked={!!stored}
        disabled={!editable}
        onChange={(e) => onCommit(e.currentTarget.checked)}
      />
    );
  }

  // Computed/relation cells are read-only (set elsewhere); render as text.
  const readOnly =
    !editable ||
    [
      "formula",
      "lookup",
      "rollup",
      "relation",
      "created_time",
      "updated_time",
      "created_by",
      "updated_by",
      "autonumber",
    ].includes(field.type);

  return (
    <EditableText
      value={stored == null ? "" : String(stored)}
      readOnly={readOnly}
      onCommit={onCommit}
    />
  );
}

function EditableText({
  value,
  readOnly,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  onCommit: (value: unknown) => void;
}) {
  const [local, setLocal] = useState(value);
  // Keep local state in sync when the underlying value changes after a refresh.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setLocal(value);
  }

  if (readOnly) {
    return <Text size="sm">{value}</Text>;
  }

  return (
    <TextInput
      size="xs"
      variant="unstyled"
      value={local}
      onChange={(e) => setLocal(e.currentTarget.value)}
      onBlur={() => {
        if (local !== value) onCommit(local === "" ? null : local);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
