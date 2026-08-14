import { Badge, Group, Text } from "@mantine/core";
import { MxdField, MxdRecord } from "../mxd-data.api";
import { useMxdRelated, useMxdTable } from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  field: MxdField;
  record: MxdRecord;
  editable: boolean;
  onOpen: () => void;
}

// Relation cell: shows the linked records' primary values as chips. Relations are
// edges, not stored cell values, so they're fetched per (record, field). Clicking
// (when editable) opens the link picker.
export function MxdRelationCell({ tableId, field, record, editable, onOpen }: Props) {
  const relatedTableId: string | undefined = field.config?.relatedTableId;
  const related = useMxdRelated(tableId, field.id, record.id, !!relatedTableId);
  const relTable = useMxdTable(relatedTableId ?? "");
  const primaryFieldId = relTable.data?.primaryFieldId ?? undefined;

  const label = (rec: MxdRecord): string => {
    const v = primaryFieldId ? rec.data?.[primaryFieldId] : undefined;
    const s = v == null ? "" : String(v);
    return s || "(untitled)";
  };

  const items = related.data ?? [];

  return (
    <Group
      gap={4}
      wrap="wrap"
      onClick={editable ? onOpen : undefined}
      style={{ cursor: editable ? "pointer" : "default", minHeight: 20 }}
    >
      {items.length === 0 && (
        <Text size="sm" c="dimmed">
          {editable ? "+ Link" : "—"}
        </Text>
      )}
      {items.map((rec) => (
        <Badge key={rec.id} size="sm" variant="light" radius="sm" color="blue">
          {label(rec)}
        </Badge>
      ))}
    </Group>
  );
}
