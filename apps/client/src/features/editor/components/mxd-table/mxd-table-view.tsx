import { useState } from "react";
import { NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
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
import {
  IconCopy,
  IconDots,
  IconDownload,
  IconHistory,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MxdField,
  MxdRecord,
  MxdView,
  mxdCreateRecord,
  mxdCreateTable,
  mxdCreateView,
  mxdDeleteRecord,
  mxdDuplicateRecord,
  mxdExportCsv,
  mxdListFields,
  mxdListViews,
  mxdQueryRecords,
  mxdSearchRecords,
  mxdUpdateRecord,
} from "@/features/mxd-data/mxd-data.api.ts";
import { MxdCell } from "@/features/mxd-data/components/mxd-cell.tsx";
import { MxdAddColumnModal } from "@/features/mxd-data/components/mxd-add-column-modal.tsx";
import { MxdImportCsvModal } from "@/features/mxd-data/components/mxd-import-csv-modal.tsx";
import { MxdHistoryModal } from "@/features/mxd-data/components/mxd-history-modal.tsx";

// MXD data platform — the mxdTable NodeView (roadmap §16/§20/§23). Renders the
// relational grid/list/board referenced by node.attrs.tableId, fetched through
// the /mxd API. Row data is never read from the ProseMirror document. Records are
// loaded via records/query so the active view's filter/sort apply server-side;
// a non-empty search box switches the source to records/search.
export default function MxdTableView(props: NodeViewProps) {
  const tableId: string | null = props.node.attrs.tableId ?? null;
  const editable = props.editor.isEditable;
  const queryClient = useQueryClient();
  const [activeViewId, setActiveViewId] = useState<string | null>(
    props.node.attrs.viewId ?? null,
  );
  const [search, setSearch] = useState("");
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [historyRecordId, setHistoryRecordId] = useState<string | null>(null);
  const searching = search.trim().length > 0;

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

  const searchQuery = useQuery({
    queryKey: ["mxd-search", tableId, search.trim()],
    queryFn: () =>
      mxdSearchRecords({ tableId: tableId as string, query: search.trim() }),
    enabled: !!tableId && searching,
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["mxd-records", tableId] });

  const commitCell = async (
    record: MxdRecord,
    fieldId: string,
    value: unknown,
  ) => {
    try {
      const updated = await mxdUpdateRecord({
        tableId: tableId as string,
        recordId: record.id,
        version: record.version,
        cells: { [fieldId]: value },
      });
      // Patch the cache in place rather than invalidating+refetching. A refetch
      // re-renders the grid and can drop an edit already in progress in another
      // cell; patching also carries the new version forward so a repeat edit of
      // the same cell doesn't 409.
      queryClient.setQueriesData(
        { queryKey: ["mxd-records", tableId] },
        (old: any) => {
          if (!old?.items) return old;
          return {
            ...old,
            items: old.items.map((r: MxdRecord) =>
              r.id === record.id ? updated : r,
            ),
          };
        },
      );
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

  const duplicateRow = async (record: MxdRecord) => {
    try {
      await mxdDuplicateRecord({ tableId: tableId as string, recordId: record.id });
      refresh();
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? "Could not duplicate the row",
      });
    }
  };

  const deleteRow = async (record: MxdRecord) => {
    try {
      await mxdDeleteRecord({
        tableId: tableId as string,
        recordId: record.id,
        version: record.version,
      });
      refresh();
    } catch (err: any) {
      const status = err?.response?.status;
      notifications.show({
        color: status === 409 ? "yellow" : "red",
        message:
          status === 409
            ? "This record changed elsewhere — reloading latest."
            : (err?.response?.data?.message ?? "Could not delete the row"),
      });
      refresh();
    }
  };

  const exportCsv = async () => {
    try {
      const res = await mxdExportCsv(tableId as string);
      downloadText(res.filename, res.csv);
      if (res.truncated) {
        notifications.show({
          color: "yellow",
          message: `Export capped at ${res.rowCount} rows`,
        });
      }
    } catch (err: any) {
      notifications.show({
        color: "red",
        message: err?.response?.data?.message ?? "Export failed",
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
  const records = searching
    ? (searchQuery.data?.items ?? [])
    : (recordsQuery.data?.items ?? []);
  const recordsLoading = searching
    ? searchQuery.isLoading
    : recordsQuery.isLoading;

  const rendererProps = { fields, records, editable, commitCell };

  return (
    <NodeViewWrapper>
      {/* toolbar */}
      <Group justify="space-between" mb="xs" wrap="nowrap" gap="xs">
        <Group gap="xs" wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={activeView?.id ?? ""}
            onChange={(v) => setActiveViewId(v)}
            data={views.map((v) => ({ label: v.name, value: v.id }))}
          />
          {editable && (
            <Menu shadow="md" position="bottom-start">
              <Menu.Target>
                <ActionIcon size="sm" variant="light" aria-label="Add view">
                  <IconPlus size={16} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Add view</Menu.Label>
                <Menu.Item onClick={() => addView("grid")}>Grid</Menu.Item>
                <Menu.Item onClick={() => addView("list")}>List</Menu.Item>
                <Menu.Item onClick={() => addView("board")}>Board</Menu.Item>
                <Menu.Item onClick={() => addView("gallery")}>Gallery</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>

        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="xs"
            placeholder="Search…"
            leftSection={<IconSearch size={14} />}
            rightSection={
              search ? (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                >
                  <IconX size={12} />
                </ActionIcon>
              ) : null
            }
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            w={180}
          />
          {editable && (
            <>
              <ActionIcon
                size="sm"
                variant="light"
                aria-label="Add column"
                onClick={() => setAddColumnOpen(true)}
                title="Add column"
              >
                <IconPlus size={16} />
              </ActionIcon>
              <Menu shadow="md" position="bottom-end">
                <Menu.Target>
                  <ActionIcon size="sm" variant="light" aria-label="Data menu">
                    <IconDots size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    leftSection={<IconDownload size={14} />}
                    onClick={exportCsv}
                  >
                    Export CSV
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconUpload size={14} />}
                    onClick={() => setImportOpen(true)}
                  >
                    Import CSV
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </>
          )}
        </Group>
      </Group>

      {recordsLoading ? (
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      ) : searching || activeView?.type === "grid" || !activeView ? (
        <GridView
          {...rendererProps}
          onDuplicate={duplicateRow}
          onDelete={deleteRow}
          onHistory={(r) => setHistoryRecordId(r.id)}
        />
      ) : activeView?.type === "board" ? (
        <BoardView {...rendererProps} view={activeView} />
      ) : activeView?.type === "gallery" ? (
        <GalleryView {...rendererProps} view={activeView} />
      ) : activeView?.type === "list" ? (
        <ListView {...rendererProps} />
      ) : (
        <GridView
          {...rendererProps}
          onDuplicate={duplicateRow}
          onDelete={deleteRow}
          onHistory={(r) => setHistoryRecordId(r.id)}
        />
      )}

      {editable && !searching && (
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
      {searching && (
        <Text size="xs" c="dimmed" mt="xs">
          {records.length} match(es) for “{search.trim()}”
        </Text>
      )}

      <MxdAddColumnModal
        tableId={tableId}
        opened={addColumnOpen}
        onClose={() => setAddColumnOpen(false)}
      />
      <MxdImportCsvModal
        tableId={tableId}
        opened={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <MxdHistoryModal
        tableId={tableId}
        recordId={historyRecordId}
        fields={fields}
        onClose={() => setHistoryRecordId(null)}
      />
    </NodeViewWrapper>
  );
}

interface RendererProps {
  fields: MxdField[];
  records: MxdRecord[];
  editable: boolean;
  commitCell: (record: MxdRecord, fieldId: string, value: unknown) => void;
}

interface GridProps extends RendererProps {
  onDuplicate: (record: MxdRecord) => void;
  onDelete: (record: MxdRecord) => void;
  onHistory: (record: MxdRecord) => void;
}

function GridView({
  fields,
  records,
  editable,
  commitCell,
  onDuplicate,
  onDelete,
  onHistory,
}: GridProps) {
  // A single cell coordinate is in edit mode at a time.
  const [editing, setEditing] = useState<{
    recordId: string;
    fieldId: string;
  } | null>(null);

  return (
    // A plain overflow container, NOT Mantine <ScrollArea>: ScrollArea's custom
    // viewport breaks floating-ui's position observers, so any floating layer
    // anchored to a grid element (select dropdown, tooltip, menu) enters an
    // auto-update loop and hangs the page. A normal overflow div behaves.
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 6,
          minWidth: "min-content",
        }}
      >
        <Table striped withColumnBorders stickyHeader>
          <Table.Thead>
            <Table.Tr>
              {fields.map((f) => (
                <Table.Th key={f.id}>{f.name}</Table.Th>
              ))}
              {editable && <Table.Th w={104} />}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {records.map((record) => (
              <Table.Tr key={record.id}>
                {fields.map((f) => (
                  <Table.Td key={f.id}>
                    <MxdCell
                      field={f}
                      value={record.data?.[f.id]}
                      readOnly={!editable}
                      editing={
                        editing?.recordId === record.id &&
                        editing?.fieldId === f.id
                      }
                      onStartEdit={() =>
                        setEditing({ recordId: record.id, fieldId: f.id })
                      }
                      onCommit={(v) => {
                        setEditing(null);
                        commitCell(record, f.id, v);
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </Table.Td>
                ))}
                {editable && (
                  <Table.Td>
                    {/* Plain icons with a native title — NOT a Mantine Menu or
                        Tooltip. Any floating-ui layer anchored to a grid element
                        loops here (see the overflow-div note above), so row
                        actions avoid the floating layer entirely. */}
                    <Group gap={2} wrap="nowrap" justify="flex-end">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label="Duplicate row"
                        title="Duplicate"
                        onClick={() => onDuplicate(record)}
                      >
                        <IconCopy size={15} />
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label="Row history"
                        title="History"
                        onClick={() => onHistory(record)}
                      >
                        <IconHistory size={15} />
                      </ActionIcon>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        aria-label="Delete row"
                        title="Delete"
                        onClick={() => onDelete(record)}
                      >
                        <IconTrash size={15} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
              </Table.Tr>
            ))}
            {records.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={Math.max(1, fields.length) + (editable ? 1 : 0)}>
                  <Text size="sm" c="dimmed" ta="center">
                    No rows yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}

function ListView({ fields, records }: RendererProps) {
  const primary = fields[0];
  const rest = fields.slice(1, 4);
  return (
    <Stack gap={6}>
      {records.map((record) => (
        <Paper key={record.id} withBorder p="xs" radius="sm">
          <Text size="sm" fw={500}>
            {formatCell(record.data?.[primary?.id]) || "—"}
          </Text>
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

function GalleryView({ fields, records }: RendererProps & { view: MxdView }) {
  const primary = fields[0];
  const rest = fields.slice(1, 4);
  return (
    <Group align="flex-start" gap="sm">
      {records.map((record) => (
        <Card key={record.id} withBorder padding="sm" radius="sm" w={200}>
          <Text size="sm" fw={600} truncate>
            {formatCell(record.data?.[primary?.id]) || "—"}
          </Text>
          <Stack gap={2} mt={4}>
            {rest.map((f) => (
              <Text key={f.id} size="xs" c="dimmed" truncate>
                {f.name}: {formatCell(record.data?.[f.id])}
              </Text>
            ))}
          </Stack>
        </Card>
      ))}
      {records.length === 0 && (
        <Text size="sm" c="dimmed">
          No rows yet.
        </Text>
      )}
    </Group>
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

  const choices: { id: string; label: string }[] =
    groupField?.config?.options ?? groupField?.config?.choices ?? [];
  const columns = [...choices, { id: "__none__", label: "Uncategorized" }];

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
    commitCell(record, groupField.id, choiceId === "__none__" ? null : choiceId);
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
                  <Text size="sm">{formatCell(record.data?.[primary?.id])}</Text>
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
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
