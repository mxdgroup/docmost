import { Button, Section, Text } from 'react-email';
import * as React from 'react';
import { button, content, paragraph } from '../css/styles';
import { MailBody } from '../partials/partials';

// MXD: single-use sign-in link for a share-link commenter account.
interface Props {
  signInLink: string;
}

export const ShareCommenterSignInEmail = ({ signInLink }: Props) => {
  return (
    <MailBody>
      <Section style={content}>
        <Text style={paragraph}>Hi,</Text>
        <Text style={paragraph}>
          Use the button below to sign in and comment under your own name.
        </Text>
      </Section>
      <Section style={{ paddingLeft: '15px', paddingBottom: '15px' }}>
        <Button href={signInLink} style={button}>
          Sign in to comment
        </Button>
      </Section>
      <Section style={content}>
        <Text style={paragraph}>
          This link works once and expires in 15 minutes. If you didn't ask to
          sign in, you can ignore this email.
        </Text>
      </Section>
    </MailBody>
  );
};

export default ShareCommenterSignInEmail;
