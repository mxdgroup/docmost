import { useMemo, useState } from "react";
import {
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { MxdField, MxdRecord } from "../mxd-data.api";
import {
  useMxdRecordsList,
  useMxdRelated,
  useMxdRelationMutations,
  useMxdTable,
} from "../queries/mxd-data-query";

export interface RelationTarget {
  field: MxdField;
  record: MxdRecord;
}

interface Props {
  tableId: string;
  target: RelationTarget | null;
  onClose: () => void;
}

// Link picker for a relation cell: lists the related table's records, shows which
// are linked to this row, and toggles links via the relation endpoints. Single
// vs multi relation is enforced server-side; the UI simply toggles edges.
export function MxdRelationPickerModal({ tableId, target, onClose }: Props) {
  const opened = !!target;
  const field = target?.field ?? null;
  const record = target?.record ?? null;
  const relatedTableId: string | undefined = field?.config?.relatedTableId;

  const [query, setQuery] = useState("");

  const relTable = useMxdTable(relatedTableId ?? "");
  const primaryFieldId = relTable.data?.primaryFieldId ?? undefined;
  const candidates = useMxdRecordsList(relatedTableId ?? "", opened);
  const linked = useMxdRelated(
    tableId,
    field?.id ?? "",
    record?.id ?? "",
    opened,
  );
  const { link, unlink } = useMxdRelationMutations(tableId);

  const linkedIds = useMemo(
    () => new Set((linked.data ?? []).map((r) => r.id)),
    [linked.data],
  );

  const label = (rec: MxdRecord): string => {
    const v = primaryFieldId ? rec.data?.[primaryFieldId] : undefined;
    const s = v == null ? "" : String(v);
    return s || "(untitled)";
  };

  const rows = (candidates.data?.items ?? []).filter((r) =>
    label(r).toLowerCase().includes(query.trim().toLowerCase()),
  );

  const toggle = (candidate: MxdRecord, isLinked: boolean) => {
    if (!field || !record) return;
    const edge = {
      tableId,
      fieldId: field.id,
      fromRecordId: record.id,
      toRecordId: candidate.id,
    };
    if (isLinked) unlink.mutate(edge);
    else link.mutate(edge);
  };

  const loading = candidates.isLoading || linked.isLoading;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={field ? `Link records · ${field.name}` : "Link records"}
      size="md"
      centered
    >
      <Stack gap="sm">
        <TextInput
          size="xs"
          placeholder="Search records…"
          leftSection={<IconSearch size={14} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />

        {loading ? (
          <Group justify="center" my="md">
            <Loader size="sm" />
          </Group>
        ) : rows.length === 0 ? (
          <Text size="sm" c="dimmed">
            No records in the related table.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={340}>
            <Stack gap={2}>
              {rows.map((r) => {
                const isLinked = linkedIds.has(r.id);
                return (
                  <Group
                    key={r.id}
                    gap="sm"
                    wrap="nowrap"
                    px="xs"
                    py={6}
                    style={{
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                    onClick={() => toggle(r, isLinked)}
                  >
                    <Checkbox
                      size="sm"
                      checked={isLinked}
                      readOnly
                      tabIndex={-1}
                    />
                    <Text size="sm">{label(r)}</Text>
                  </Group>
                );
              })}
            </Stack>
          </ScrollArea.Autosize>
        )}

        <Text size="xs" c="dimmed">
          {linkedIds.size} linked
        </Text>
      </Stack>
    </Modal>
  );
}
