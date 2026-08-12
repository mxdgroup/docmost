import api from "@/lib/api-client";

// MXD data platform — client API for the /mxd endpoints (roadmap §16). The
// editor node fetches relational data through here; nothing relational lives in
// the ProseMirror/Y.doc.

export interface MxdField {
  id: string;
  tableId: string;
  name: string;
  type: string;
  config: Record<string, any>;
  position: number;
}

export interface MxdRecord {
  id: string;
  tableId: string;
  data: Record<string, any>;
  version: number;
  position: number;
}

export interface MxdRecordPage {
  items: MxdRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface MxdTable {
  id: string;
  workspaceId: string;
  spaceId: string;
  pageId: string | null;
  title: string;
  primaryFieldId: string | null;
}

export const mxdGetTable = (tableId: string): Promise<MxdTable> =>
  api.post("/mxd/tables/get", { tableId }).then((r) => r.data);

export const mxdListTables = (spaceId: string): Promise<MxdTable[]> =>
  api.post("/mxd/tables/list", { spaceId }).then((r) => r.data);

export const mxdCreateTable = (input: {
  pageId: string;
  title?: string;
}): Promise<MxdTable> =>
  api.post("/mxd/tables/create", input).then((r) => r.data);

export const mxdListFields = (tableId: string): Promise<MxdField[]> =>
  api.post("/mxd/fields/list", { tableId }).then((r) => r.data);

export const mxdListRecords = (
  tableId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<MxdRecordPage> =>
  api.post("/mxd/records/list", { tableId, ...opts }).then((r) => r.data);

export const mxdCreateRecord = (
  tableId: string,
  cells: Record<string, any>,
): Promise<MxdRecord> =>
  api.post("/mxd/records/create", { tableId, cells }).then((r) => r.data);

export const mxdUpdateRecord = (input: {
  tableId: string;
  recordId: string;
  version: number;
  cells: Record<string, any>;
}): Promise<MxdRecord> =>
  api.post("/mxd/records/update", input).then((r) => r.data);

export const mxdDeleteRecord = (input: {
  tableId: string;
  recordId: string;
  version: number;
}): Promise<{ success: boolean }> =>
  api.post("/mxd/records/delete", input).then((r) => r.data);

export const mxdAddField = (input: {
  tableId: string;
  name: string;
  type: string;
  config?: Record<string, any>;
}): Promise<MxdField> =>
  api.post("/mxd/fields/add", input).then((r) => r.data);

export interface MxdView {
  id: string;
  tableId: string;
  name: string;
  type: "grid" | "list" | "board" | "calendar" | "gallery";
  config: Record<string, any>;
  position: number;
}

export const mxdListViews = (tableId: string): Promise<MxdView[]> =>
  api.post("/mxd/views/list", { tableId }).then((r) => r.data);

export const mxdCreateView = (input: {
  tableId: string;
  name?: string;
  type?: string;
  config?: Record<string, any>;
}): Promise<MxdView> =>
  api.post("/mxd/views/create", input).then((r) => r.data);

export const mxdUpdateView = (input: {
  tableId: string;
  viewId: string;
  type?: string;
  config?: Record<string, any>;
}): Promise<MxdView> =>
  api.post("/mxd/views/config", input).then((r) => r.data);

// Query records THROUGH a view (server applies the view's filter/sort).
export const mxdQueryRecords = (input: {
  tableId: string;
  viewId?: string;
  config?: Record<string, any>;
  limit?: number;
  offset?: number;
}): Promise<MxdRecordPage> =>
  api.post("/mxd/records/query", input).then((r) => r.data);

export const mxdSearchRecords = (input: {
  tableId: string;
  query: string;
  limit?: number;
  offset?: number;
}): Promise<MxdRecordPage> =>
  api.post("/mxd/records/search", input).then((r) => r.data);

export const mxdDuplicateRecord = (input: {
  tableId: string;
  recordId: string;
}): Promise<MxdRecord> =>
  api.post("/mxd/records/duplicate", input).then((r) => r.data);

// ---- table lifecycle
export const mxdRenameTable = (input: {
  tableId: string;
  title: string;
}): Promise<MxdTable> =>
  api.post("/mxd/tables/rename", input).then((r) => r.data);

// ---- field lifecycle
export const mxdRenameField = (input: {
  tableId: string;
  fieldId: string;
  name: string;
}): Promise<MxdField> =>
  api.post("/mxd/fields/rename", input).then((r) => r.data);

export const mxdReorderField = (input: {
  tableId: string;
  fieldId: string;
  position: number;
}): Promise<MxdField> =>
  api.post("/mxd/fields/reorder", input).then((r) => r.data);

export const mxdUpdateFieldConfig = (input: {
  tableId: string;
  fieldId: string;
  config: Record<string, any>;
}): Promise<MxdField> =>
  api.post("/mxd/fields/config", input).then((r) => r.data);

export const mxdChangeFieldType = (input: {
  tableId: string;
  fieldId: string;
  type: string;
  clearIncompatible?: boolean;
  config?: Record<string, any>;
}): Promise<MxdField> =>
  api.post("/mxd/fields/change-type", input).then((r) => r.data);

export const mxdDeleteField = (input: {
  tableId: string;
  fieldId: string;
}): Promise<{ success: boolean }> =>
  api.post("/mxd/fields/delete", input).then((r) => r.data);

// ---- view lifecycle
export const mxdRenameView = (input: {
  tableId: string;
  viewId: string;
  name: string;
}): Promise<MxdView> =>
  api.post("/mxd/views/rename", input).then((r) => r.data);

export const mxdDeleteView = (input: {
  tableId: string;
  viewId: string;
}): Promise<{ success: boolean }> =>
  api.post("/mxd/views/delete", input).then((r) => r.data);

// ---- relations
export interface MxdRelationEdge {
  tableId: string;
  fieldId: string;
  fromRecordId: string;
  toRecordId: string;
}
export const mxdLinkRelation = (input: MxdRelationEdge): Promise<any> =>
  api.post("/mxd/relations/link", input).then((r) => r.data);
export const mxdUnlinkRelation = (input: MxdRelationEdge): Promise<any> =>
  api.post("/mxd/relations/unlink", input).then((r) => r.data);
export const mxdListRelated = (input: {
  tableId: string;
  fieldId: string;
  recordId: string;
}): Promise<MxdRecord[]> =>
  api.post("/mxd/relations/list", input).then((r) => r.data);

// ---- buttons
export const mxdRunButton = (input: {
  tableId: string;
  fieldId: string;
  recordId: string;
}): Promise<{ success: boolean; directives: { type: string; [k: string]: any }[] }> =>
  api.post("/mxd/buttons/run", input).then((r) => r.data);

// ---- automations
export interface MxdAutomationRule {
  id: string;
  tableId: string;
  name: string;
  enabled: boolean;
  trigger: Record<string, any>;
  actions: Record<string, any>[];
}
export const mxdListAutomations = (tableId: string): Promise<MxdAutomationRule[]> =>
  api.post("/mxd/automations/list", { tableId }).then((r) => r.data);
export const mxdCreateAutomation = (input: {
  tableId: string;
  name?: string;
  trigger: Record<string, any>;
  actions: Record<string, any>[];
  enabled?: boolean;
}): Promise<MxdAutomationRule> =>
  api.post("/mxd/automations/create", input).then((r) => r.data);
export const mxdUpdateAutomation = (input: {
  tableId: string;
  ruleId: string;
  name?: string;
  trigger?: Record<string, any>;
  actions?: Record<string, any>[];
  enabled?: boolean;
}): Promise<MxdAutomationRule> =>
  api.post("/mxd/automations/update", input).then((r) => r.data);
export const mxdDeleteAutomation = (input: {
  tableId: string;
  ruleId: string;
}): Promise<{ success: boolean }> =>
  api.post("/mxd/automations/delete", input).then((r) => r.data);

// ---- CSV
export interface MxdCsvExport {
  filename: string;
  csv: string;
  rowCount: number;
  truncated: boolean;
}
export const mxdExportCsv = (tableId: string): Promise<MxdCsvExport> =>
  api.post("/mxd/records/export-csv", { tableId }).then((r) => r.data);

export interface MxdCsvImport {
  created: number;
  totalRows: number;
  errors: { row: number; message: string }[];
  unmappedColumns: string[];
}
export const mxdImportCsv = (input: {
  tableId: string;
  csv: string;
}): Promise<MxdCsvImport> =>
  api.post("/mxd/records/import-csv", input).then((r) => r.data);

// ---- history
export interface MxdHistoryEntry {
  id: string;
  recordId: string;
  action: "create" | "update" | "delete";
  actorId: string | null;
  actorGuestName: string | null;
  data: Record<string, any>;
  changedFieldIds: string[];
  createdAt: string;
}
export const mxdRecordHistory = (input: {
  tableId: string;
  recordId: string;
  limit?: number;
}): Promise<MxdHistoryEntry[]> =>
  api.post("/mxd/records/history", input).then((r) => r.data);
