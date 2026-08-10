import { useState } from "react";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Menu,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MxdField,
  MxdRecord,
  MxdView,
  mxdCreateRecord,
  mxdCreateTable,
  mxdCreateView,
  mxdListFields,
  mxdListViews,
  mxdQueryRecords,
  mxdUpdateRecord,
} from "@/features/mxd-data/mxd-data.api.ts";

// MXD data platform — the mxdTable NodeView (roadmap §16/§20/§23). Renders the
// relational grid/list/board referenced by node.attrs.tableId, fetched through
// the /mxd API. Row data is never read from the ProseMirror document. Records are
// loaded via records/query so the active view's filter/sort apply server-side.
export default function MxdTableView(props: NodeViewProps) {
  const tableId: string | null = props.node.attrs.tableId ?? null;
  const editable = props.editor.isEditable;
  const queryClient = useQueryClient();
  const [activeViewId, setActiveViewId] = useState<string | null>(
    props.node.attrs.viewId ?? null,
  );

  const fieldsQuery = useQuery<MxdField[]>({
    queryKey: ["mxd-fields", tableId],
    queryFn: () => mxdListFields(tableId as string),
    enabled: !!tableId,
  });
  const viewsQuery = useQuery<MxdView[]>({
    queryKey: ["mxd-views", tableId],
    queryFn: () => mxdListViews(tableId as string),
    enabled: !!tableId,
  });

  const views = viewsQuery.data ?? [];
  const activeView =
    views.find((v) => v.id === activeViewId) ?? views[0] ?? null;

  const recordsQuery = useQuery({
    queryKey: ["mxd-records", tableId, activeView?.id],
    queryFn: () =>
      mxdQueryRecords({
        tableId: tableId as string,
        viewId: activeView?.id,
        limit: 200,
      }),
    enabled: !!tableId && !!activeView,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["mxd-records", tableId] });

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
      notifications.show({
        color: status === 409 ? "yellow" : "red",
        message:
          status === 409
            ? "This record changed elsewhere — reloading latest."
            : (err?.response?.data?.message ?? "Could not save the change"),
      });
      refresh();
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

  const addView = async (type: string) => {
    try {
      const view = await mxdCreateView({
        tableId: tableId as string,
        name: type[0].toUpperCase() + type.slice(1),
        type,
      });
      await queryClient.invalidateQueries({ queryKey: ["mxd-views", tableId] });
      setActiveViewId(view.id);
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? "Could not create the view",
      });
    }
  };

  if (!tableId) {
    const pageId: string | undefined = (props.editor.storage as any).pageId;
    const createTable = async () => {
      if (!pageId) return;
      try {
        const table = await mxdCreateTable({ pageId, title: "Table" });
        props.updateAttributes({ tableId: table.id, viewId: null });
      } catch (err: any) {
        notifications.show({
          color: "red",
          message:
            err?.response?.data?.message ?? "Could not create the table",
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

  if (fieldsQuery.isLoading || viewsQuery.isLoading) {
    return (
      <NodeViewWrapper>
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      </NodeViewWrapper>
    );
  }
  if (fieldsQuery.isError || viewsQuery.isError) {
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

  const rendererProps = { fields, records, editable, commitCell };

  return (
    <NodeViewWrapper>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <SegmentedControl
          size="xs"
          value={activeView?.id ?? ""}
          onChange={(v) => setActiveViewId(v)}
          data={views.map((v) => ({ label: v.name, value: v.id }))}
        />
        {editable && (
          <Menu shadow="md" position="bottom-end">
            <Menu.Target>
              <ActionIcon size="sm" variant="light" aria-label="Add view">
                <IconPlus size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => addView("grid")}>Grid</Menu.Item>
              <Menu.Item onClick={() => addView("list")}>List</Menu.Item>
              <Menu.Item onClick={() => addView("board")}>Board</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      {recordsQuery.isLoading ? (
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      ) : activeView?.type === "board" ? (
        <BoardView {...rendererProps} view={activeView} />
      ) : activeView?.type === "list" ? (
        <ListView {...rendererProps} />
      ) : (
        <GridView {...rendererProps} />
      )}

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

interface RendererProps {
  fields: MxdField[];
  records: MxdRecord[];
  editable: boolean;
  commitCell: (record: MxdRecord, fieldId: string, value: unknown) => void;
}

function GridView({ fields, records, editable, commitCell }: RendererProps) {
  return (
    <ScrollArea type="auto">
      <div
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 6,
        }}
      >
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
                      onCommit={(v) => commitCell(record, f.id, v)}
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
    </ScrollArea>
  );
}

function ListView({ fields, records, editable, commitCell }: RendererProps) {
  const primary = fields[0];
  const rest = fields.slice(1, 4);
  return (
    <Stack gap={6}>
      {records.map((record) => (
        <Paper key={record.id} withBorder p="xs" radius="sm">
          <MxdCell
            field={primary}
            record={record}
            editable={editable}
            onCommit={(v) => commitCell(record, primary.id, v)}
          />
          <Group gap="md" mt={4}>
            {rest.map((f) => (
              <Text key={f.id} size="xs" c="dimmed">
                {f.name}: {formatCell(record.data?.[f.id])}
              </Text>
            ))}
          </Group>
        </Paper>
      ))}
      {records.length === 0 && (
        <Text size="sm" c="dimmed" ta="center">
          No rows yet.
        </Text>
      )}
    </Stack>
  );
}

function BoardView({
  fields,
  records,
  editable,
  commitCell,
  view,
}: RendererProps & { view: MxdView }) {
  const groupFieldId: string | undefined = view.config?.groupByFieldId;
  const groupField = fields.find((f) => f.id === groupFieldId);
  const primary = fields[0];

  // Columns come from a select field's choices; fall back to a single column.
  const choices: { id: string; label: string }[] =
    groupField?.config?.choices ?? [];
  const columns = [
    ...choices,
    { id: "__none__", label: "Uncategorized" },
  ];

  if (!groupField) {
    return (
      <Alert color="gray" variant="light">
        <Text size="sm">
          This board needs a “group by” select field. Set one in the view
          settings.
        </Text>
      </Alert>
    );
  }

  const bucket = (choiceId: string) =>
    records.filter((r) => {
      const v = r.data?.[groupField.id];
      return choiceId === "__none__" ? v == null : v === choiceId;
    });

  const onDrop = (recordId: string, choiceId: string) => {
    const record = records.find((r) => r.id === recordId);
    if (!record) return;
    // Moving a card = a validated record mutation (server rechecks authz,
    // version, and that the value is an allowed choice) — item §21.
    commitCell(
      record,
      groupField.id,
      choiceId === "__none__" ? null : choiceId,
    );
  };

  return (
    <ScrollArea type="auto">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        {columns.map((col) => (
          <div
            key={col.id}
            style={{ minWidth: 200, flex: "0 0 200px" }}
            onDragOver={(e) => editable && e.preventDefault()}
            onDrop={(e) => {
              if (!editable) return;
              const id = e.dataTransfer.getData("text/mxd-record");
              if (id) onDrop(id, col.id);
            }}
          >
            <Group justify="space-between" mb={4}>
              <Text size="xs" fw={600}>
                {col.label}
              </Text>
              <Badge size="xs" variant="light">
                {bucket(col.id).length}
              </Badge>
            </Group>
            <Stack gap={6}>
              {bucket(col.id).map((record) => (
                <Card
                  key={record.id}
                  withBorder
                  padding="xs"
                  radius="sm"
                  draggable={editable}
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/mxd-record", record.id)
                  }
                >
                  <Text size="sm">{formatCell(record.data?.[primary.id])}</Text>
                </Card>
              ))}
            </Stack>
          </div>
        ))}
      </Group>
    </ScrollArea>
  );
}

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  return String(value);
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
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
