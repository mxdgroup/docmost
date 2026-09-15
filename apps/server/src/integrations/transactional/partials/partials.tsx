import {
  brand,
  button as buttonStyle,
  container,
  fontFamily,
  footer,
  logo,
  main,
} from '../css/styles';
import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
} from 'react-email';
import * as React from 'react';

interface MailBodyProps {
  children: React.ReactNode;
  // MXD: inbox preview line (the snippet shown next to the subject)
  preview?: string;
}

export function MailBody({ children, preview }: MailBodyProps) {
  return (
    <Html>
      <Head />
      {preview && <Preview>{preview}</Preview>}
      <Body style={main}>
        <Container style={container}>
          <MailHeader />
          {children}
        </Container>
        <MailFooter />
      </Body>
    </Html>
  );
}

export function MailHeader() {
  return (
    <Section style={logo}>
      <Img src={brand.logoUrl} width="112" height="27" alt="MxD" />
    </Section>
  );
}

interface EmailButtonProps {
  href: string;
  children: React.ReactNode;
}

// MXD: pill button in the brand blue (table-based for Outlook).
export function EmailButton({ href, children }: EmailButtonProps) {
  return (
    <table
      role="presentation"
      cellPadding="0"
      cellSpacing="0"
      style={{ margin: '8px 4px 24px' }}
    >
      <tr>
        <td
          style={{
            backgroundColor: buttonStyle.backgroundColor,
            borderRadius: buttonStyle.borderRadius,
            textAlign: 'center' as const,
          }}
        >
          <a
            href={href}
            target="_blank"
            style={{
              color: buttonStyle.color,
              fontFamily: buttonStyle.fontFamily,
              fontSize: buttonStyle.fontSize,
              fontWeight: buttonStyle.fontWeight,
              textDecoration: 'none',
              display: 'inline-block',
              padding: buttonStyle.padding,
            }}
          >
            {children}
          </a>
        </td>
      </tr>
    </table>
  );
}

export function MailFooter() {
  return (
    <Section style={footer}>
      <Row>
        <Text
          style={{
            fontFamily,
            textAlign: 'center',
            color: brand.steel,
            fontSize: '13px',
            lineHeight: '20px',
            margin: 0,
          }}
        >
          MxD · docs.mxd.digital
          <br />
          Questions? Just reply to this email.
        </Text>
      </Row>
    </Section>
  );
}

export function getGreetingName(name?: string): string {
  return name?.split(' ')[0] || 'there';
}
