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

export const mxdCreateTable = (input: {
  spaceId: string;
  pageId?: string;
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
