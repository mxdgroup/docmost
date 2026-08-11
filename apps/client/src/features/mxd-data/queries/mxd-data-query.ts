import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  MxdField,
  MxdRecordPage,
  MxdTable,
  MxdView,
  MxdHistoryEntry,
  mxdAddField,
  mxdChangeFieldType,
  mxdCreateRecord,
  mxdCreateView,
  mxdDeleteField,
  mxdDeleteRecord,
  mxdDeleteView,
  mxdDuplicateRecord,
  mxdExportCsv,
  mxdGetTable,
  mxdImportCsv,
  mxdListFields,
  mxdListViews,
  mxdQueryRecords,
  mxdRecordHistory,
  mxdRenameField,
  mxdReorderField,
  mxdRenameView,
  mxdRunButton,
  mxdSearchRecords,
  mxdUpdateFieldConfig,
  mxdUpdateRecord,
  mxdUpdateView,
} from "../mxd-data.api";

// MXD data platform — React Query hooks. Query keys are namespaced by table so a
// mutation can invalidate exactly the affected table's fields/records/views.

// Query keys match the NodeView's existing convention so a mutation here
// invalidates exactly the caches the embedded table view reads.
const keys = {
  table: (tableId: string) => ["mxd-table", tableId] as const,
  fields: (tableId: string) => ["mxd-fields", tableId] as const,
  views: (tableId: string) => ["mxd-views", tableId] as const,
  records: (tableId: string) => ["mxd-records", tableId] as const,
  history: (tableId: string, recordId: string) =>
    ["mxd-history", tableId, recordId] as const,
};

function notifyError(err: any, fallback: string) {
  const message =
    err?.response?.data?.message || err?.message || fallback;
  notifications.show({ message: String(message), color: "red" });
}

export function useMxdTable(tableId: string): UseQueryResult<MxdTable> {
  return useQuery({
    queryKey: keys.table(tableId),
    queryFn: () => mxdGetTable(tableId),
    enabled: !!tableId,
  });
}

export function useMxdFields(tableId: string): UseQueryResult<MxdField[]> {
  return useQuery({
    queryKey: keys.fields(tableId),
    queryFn: () => mxdListFields(tableId),
    enabled: !!tableId,
  });
}

export function useMxdViews(tableId: string): UseQueryResult<MxdView[]> {
  return useQuery({
    queryKey: keys.views(tableId),
    queryFn: () => mxdListViews(tableId),
    enabled: !!tableId,
  });
}

// Records THROUGH a view (server applies filter/sort). viewId omitted => all.
export function useMxdRecords(
  tableId: string,
  viewId?: string,
): UseQueryResult<MxdRecordPage> {
  return useQuery({
    queryKey: [...keys.records(tableId), viewId ?? "all"],
    queryFn: () => mxdQueryRecords({ tableId, viewId, limit: 200 }),
    enabled: !!tableId,
  });
}

export function useMxdRecordHistory(
  tableId: string,
  recordId: string,
  enabled = true,
): UseQueryResult<MxdHistoryEntry[]> {
  return useQuery({
    queryKey: keys.history(tableId, recordId),
    queryFn: () => mxdRecordHistory({ tableId, recordId }),
    enabled: enabled && !!tableId && !!recordId,
  });
}

// ---- mutations. Each invalidates the records (and fields/views where relevant)
// of the affected table so the grid re-reads the authoritative server state.

export function useMxdRecordMutations(tableId: string) {
  const qc = useQueryClient();
  const invalidateRecords = () =>
    qc.invalidateQueries({ queryKey: ["mxd-records", tableId] });

  const create = useMutation({
    mutationFn: (cells: Record<string, any>) => mxdCreateRecord(tableId, cells),
    onSuccess: invalidateRecords,
    onError: (e) => notifyError(e, "Could not create the row"),
  });

  const update = useMutation({
    mutationFn: (input: {
      recordId: string;
      version: number;
      cells: Record<string, any>;
    }) => mxdUpdateRecord({ tableId, ...input }),
    onSuccess: invalidateRecords,
    onError: (e) => notifyError(e, "Could not save the change"),
  });

  const remove = useMutation({
    mutationFn: (input: { recordId: string; version: number }) =>
      mxdDeleteRecord({ tableId, ...input }),
    onSuccess: invalidateRecords,
    onError: (e) => notifyError(e, "Could not delete the row"),
  });

  const duplicate = useMutation({
    mutationFn: (recordId: string) => mxdDuplicateRecord({ tableId, recordId }),
    onSuccess: invalidateRecords,
    onError: (e) => notifyError(e, "Could not duplicate the row"),
  });

  const runButton = useMutation({
    mutationFn: (input: { fieldId: string; recordId: string }) =>
      mxdRunButton({ tableId, ...input }),
    onSuccess: (res) => {
      invalidateRecords();
      for (const d of res.directives ?? []) {
        if (d.type === "openUrl" && typeof d.url === "string") {
          window.open(d.url, "_blank", "noopener,noreferrer");
        }
      }
    },
    onError: (e) => notifyError(e, "Button action failed"),
  });

  return { create, update, remove, duplicate, runButton };
}

export function useMxdFieldMutations(tableId: string) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: keys.fields(tableId) });
    qc.invalidateQueries({ queryKey: ["mxd-records", tableId] });
  };

  const add = useMutation({
    mutationFn: (input: { name: string; type: string; config?: any }) =>
      mxdAddField({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not add the column"),
  });
  const rename = useMutation({
    mutationFn: (input: { fieldId: string; name: string }) =>
      mxdRenameField({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not rename the column"),
  });
  const reorder = useMutation({
    mutationFn: (input: { fieldId: string; position: number }) =>
      mxdReorderField({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not reorder the column"),
  });
  const config = useMutation({
    mutationFn: (input: { fieldId: string; config: any }) =>
      mxdUpdateFieldConfig({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not update the column"),
  });
  const changeType = useMutation({
    mutationFn: (input: {
      fieldId: string;
      type: string;
      clearIncompatible?: boolean;
      config?: any;
    }) => mxdChangeFieldType({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not change the column type"),
  });
  const remove = useMutation({
    mutationFn: (fieldId: string) => mxdDeleteField({ tableId, fieldId }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not delete the column"),
  });

  return { add, rename, reorder, config, changeType, remove };
}

export function useMxdViewMutations(tableId: string) {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: keys.views(tableId) });

  const create = useMutation({
    mutationFn: (input: { name?: string; type?: string; config?: any }) =>
      mxdCreateView({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not create the view"),
  });
  const update = useMutation({
    mutationFn: (input: { viewId: string; type?: string; config?: any }) =>
      mxdUpdateView({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not update the view"),
  });
  const rename = useMutation({
    mutationFn: (input: { viewId: string; name: string }) =>
      mxdRenameView({ tableId, ...input }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not rename the view"),
  });
  const remove = useMutation({
    mutationFn: (viewId: string) => mxdDeleteView({ tableId, viewId }),
    onSuccess: invalidate,
    onError: (e) => notifyError(e, "Could not delete the view"),
  });

  return { create, update, rename, remove };
}

// CSV import/export are one-shot actions (no cache) — expose plain async helpers.
export function useMxdCsv(tableId: string) {
  const qc = useQueryClient();
  const exportCsv = useMutation({
    mutationFn: () => mxdExportCsv(tableId),
    onError: (e) => notifyError(e, "Export failed"),
  });
  const importCsv = useMutation({
    mutationFn: (csv: string) => mxdImportCsv({ tableId, csv }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["mxd-records", tableId] }),
    onError: (e) => notifyError(e, "Import failed"),
  });
  return { exportCsv, importCsv };
}

export function useMxdSearch(tableId: string) {
  return useMutation({
    mutationFn: (query: string) => mxdSearchRecords({ tableId, query }),
  });
}
