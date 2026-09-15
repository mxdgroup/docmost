import { Section, Text } from 'react-email';
import * as React from 'react';
import { brand, h1, link, paragraph } from '../css/styles';
import { EmailButton, MailBody } from '../partials/partials';

// MXD: single-use sign-in link for a share-link commenter account.
interface Props {
  signInLink: string;
}

export const ShareCommenterSignInEmail = ({ signInLink }: Props) => {
  return (
    <MailBody preview="Your link to comment under your own name on MxD Docs.">
      <Section style={{ padding: '0 4px' }}>
        <Text style={h1}>Sign in to comment</Text>
        <Text style={paragraph}>
          Use the button below to sign in on MxD Docs. Your comments will show
          your name instead of appearing as a guest, including any you've
          already left from this browser.
        </Text>
      </Section>
      <EmailButton href={signInLink}>Sign in and continue</EmailButton>
      <Section style={{ padding: '0 4px' }}>
        <Text style={{ ...paragraph, fontSize: '14px', lineHeight: '22px' }}>
          This link works once and stays valid for 24 hours. If you didn't ask
          to sign in, you can safely ignore this email.
        </Text>
        <Text
          style={{
            ...paragraph,
            fontSize: '13px',
            lineHeight: '20px',
            margin: '16px 0 0',
            paddingTop: '16px',
            borderTop: `1px solid ${brand.rule}`,
          }}
        >
          Button not working? Paste this link into your browser:
          <br />
          <a href={signInLink} style={{ ...link, wordBreak: 'break-all' }}>
            {signInLink}
          </a>
        </Text>
      </Section>
    </MailBody>
  );
};

export default ShareCommenterSignInEmail;
