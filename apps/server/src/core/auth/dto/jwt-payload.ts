export enum JwtType {
  ACCESS = 'access',
  COLLAB = 'collab',
  // MXD: share-scoped anonymous collab session (no user id — ever)
  SHARE_COLLAB = 'share_collab',
  EXCHANGE = 'exchange',
  ATTACHMENT = 'attachment',
  MFA_TOKEN = 'mfa_token',
  API_KEY = 'api_key',
  PDF_RENDER = 'pdf_render',
  PDF_EXPORT_DOWNLOAD = 'pdf_export_download',
}
export type JwtPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  type: 'access';
  sessionId?: string;
};

export type JwtCollabPayload = {
  sub: string;
  workspaceId: string;
  type: 'collab';
};

// MXD: carries the share and target page only — never a user id. The collab
// auth extension re-validates the share and scope server-side on connect.
export type JwtShareCollabPayload = {
  shareId: string;
  pageId: string;
  workspaceId: string;
  type: 'share_collab';
};

export type JwtExchangePayload = {
  sub: string;
  workspaceId: string;
  type: 'exchange';
};

export type JwtAttachmentPayload = {
  attachmentId: string;
  pageId: string;
  workspaceId: string;
  type: 'attachment';
};

export interface JwtMfaTokenPayload {
  sub: string;
  workspaceId: string;
  type: 'mfa_token';
}

export type JwtApiKeyPayload = {
  sub: string;
  workspaceId: string;
  apiKeyId: string;
  type: 'api_key';
};

export type JwtPdfRenderPayload = {
  pageId: string;
  workspaceId: string;
  type: 'pdf_render';
};

export type JwtPdfExportDownloadPayload = {
  fileTaskId: string;
  workspaceId: string;
  type: 'pdf_export_download';
};
