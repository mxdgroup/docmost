import {
  Badge,
  Group,
  Loader,
  Modal,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { MxdField } from "../mxd-data.api";
import { renderCellText } from "../mxd-field-types";
import { useMxdRecordHistory } from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  recordId: string | null;
  fields: MxdField[];
  onClose: () => void;
}

const ACTION_COLOR: Record<string, string> = {
  create: "green",
  update: "blue",
  delete: "red",
};

// Read-only audit trail for one record: most-recent-first, showing who changed
// what and when. Snapshots are the server's authoritative history rows.
export function MxdHistoryModal({ tableId, recordId, fields, onClose }: Props) {
  const opened = !!recordId;
  const historyQuery = useMxdRecordHistory(tableId, recordId ?? "", opened);
  const fieldName = (id: string) =>
    fields.find((f) => f.id === id)?.name ?? id;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Row history"
      size="lg"
      centered
    >
      {historyQuery.isLoading ? (
        <Group justify="center" my="md">
          <Loader size="sm" />
        </Group>
      ) : (historyQuery.data ?? []).length === 0 ? (
        <Text size="sm" c="dimmed">
          No history yet.
        </Text>
      ) : (
        <Stack gap="xs">
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Changed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(historyQuery.data ?? []).map((h) => (
                <Table.Tr key={h.id}>
                  <Table.Td>
                    <Text size="xs">{new Date(h.createdAt).toLocaleString()}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={ACTION_COLOR[h.action] ?? "gray"}>
                      {h.action}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {(h.changedFieldIds ?? [])
                        .map((id) => `${fieldName(id)}: ${renderCellText(h.data?.[id])}`)
                        .join("  ·  ") || "—"}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Modal>
  );
}
