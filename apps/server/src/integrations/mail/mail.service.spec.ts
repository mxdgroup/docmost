import { MailService } from './mail.service';

// MXD: every outgoing email carries MAIL_REPLY_TO unless a message sets its own.
describe('MailService reply-to', () => {
  function build(replyTo?: string) {
    const mailDriver = { sendMail: jest.fn().mockResolvedValue(undefined) };
    const environmentService = {
      getMailBlockedRecipientDomains: () => [],
      getMailFromAddress: () => 'docs@mxd.group',
      getMailFromName: () => 'MxD Docs',
      getMailReplyTo: () => replyTo,
    };
    const service = new MailService(
      mailDriver as any,
      environmentService as any,
      { add: jest.fn() } as any,
    );
    return { service, mailDriver };
  }

  it('applies MAIL_REPLY_TO by default', async () => {
    const { service, mailDriver } = build('hello@mxd.digital');
    await service.sendEmail({ to: 'a@b.co', subject: 's', html: '<p>x</p>' });
    expect(mailDriver.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'hello@mxd.digital', to: 'a@b.co' }),
    );
  });

  it('keeps an explicit per-message reply-to', async () => {
    const { service, mailDriver } = build('hello@mxd.digital');
    await service.sendEmail({ to: 'a@b.co', subject: 's', html: 'x', replyTo: 'other@mxd.digital' });
    expect(mailDriver.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: 'other@mxd.digital' }),
    );
  });

  it('sends no reply-to when none is configured', async () => {
    const { service, mailDriver } = build(undefined);
    await service.sendEmail({ to: 'a@b.co', subject: 's', html: 'x' });
    expect(mailDriver.sendMail.mock.calls[0][0].replyTo).toBeUndefined();
  });
});
