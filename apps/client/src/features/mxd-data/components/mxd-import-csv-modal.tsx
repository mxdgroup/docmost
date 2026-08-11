import { useState } from "react";
import {
  Alert,
  Button,
  FileButton,
  Group,
  List,
  Modal,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { MxdCsvImport } from "../mxd-data.api";
import { useMxdCsv } from "../queries/mxd-data-query";

interface Props {
  tableId: string;
  opened: boolean;
  onClose: () => void;
}

// Import rows from CSV. Columns map to fields by header name; the server
// validates every cell and reports per-row errors + unmapped columns, which we
// surface so a partial import is transparent rather than silent.
export function MxdImportCsvModal({ tableId, opened, onClose }: Props) {
  const { importCsv } = useMxdCsv(tableId);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<MxdCsvImport | null>(null);

  const pickFile = async (file: File | null) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const run = async () => {
    if (!csv.trim()) return;
    const res = await importCsv.mutateAsync(csv);
    setResult(res);
    notifications.show({
      message: `Imported ${res.created} of ${res.totalRows} row(s)`,
      color: res.errors.length ? "yellow" : "green",
    });
  };

  const close = () => {
    setCsv("");
    setResult(null);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={close} title="Import CSV" size="lg" centered>
      <Stack>
        <Text size="sm" c="dimmed">
          The first row must be a header of column names matching this table's
          fields. Unknown, computed, and relation columns are skipped.
        </Text>
        <Group>
          <FileButton onChange={pickFile} accept=".csv,text/csv">
            {(fbProps) => (
              <Button variant="default" size="xs" {...fbProps}>
                Choose file…
              </Button>
            )}
          </FileButton>
          <Text size="xs" c="dimmed">
            or paste below
          </Text>
        </Group>
        <Textarea
          autosize
          minRows={5}
          maxRows={12}
          placeholder={"Name,Age\nAda,30\nBob,25"}
          value={csv}
          onChange={(e) => setCsv(e.currentTarget.value)}
          styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)" } }}
        />

        {result && (
          <Alert
            color={result.errors.length ? "yellow" : "green"}
            variant="light"
          >
            <Text size="sm">
              Created {result.created} of {result.totalRows} row(s).
            </Text>
            {result.unmappedColumns.length > 0 && (
              <Text size="xs" c="dimmed" mt={4}>
                Skipped columns: {result.unmappedColumns.join(", ")}
              </Text>
            )}
            {result.errors.length > 0 && (
              <List size="xs" mt={4}>
                {result.errors.slice(0, 8).map((e, i) => (
                  <List.Item key={i}>
                    Row {e.row}: {e.message}
                  </List.Item>
                ))}
              </List>
            )}
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={close}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button onClick={run} loading={importCsv.isPending} disabled={!csv.trim()}>
            Import
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
