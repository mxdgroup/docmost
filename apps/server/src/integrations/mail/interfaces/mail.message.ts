export interface MailMessage {
  from?: string;
  to: string;
  subject: string;
  // MXD: defaults to MAIL_REPLY_TO when unset
  replyTo?: string;
  text?: string;
  html?: string;
  template?: any;
  notificationId?: string;
}
