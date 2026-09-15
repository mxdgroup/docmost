// MXD: brand tokens for every transactional email (matches the MxD client
// onboarding emails: blue #4E61F6, ink #131927, steel #6D717F, paper #F4F4F6,
// rounded white card, pill buttons).
export const brand = {
  blue: '#4E61F6',
  ink: '#131927',
  steel: '#6D717F',
  paper: '#F4F4F6',
  rule: '#E5E7EA',
  logoUrl: 'https://mxd.digital/mxd-logo.png',
};

export const fontFamily =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export const main = {
  backgroundColor: brand.paper,
  fontFamily,
  margin: 0,
  padding: '32px 16px',
};

export const container = {
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '20px',
  padding: '32px 28px 28px',
};

export const content = {
  padding: '0 4px',
};

export const paragraph = {
  fontFamily,
  color: brand.steel,
  lineHeight: '26px',
  fontSize: '16px',
  margin: '0 0 16px',
};

export const h1 = {
  color: brand.ink,
  fontFamily,
  fontSize: '24px',
  lineHeight: '32px',
  fontWeight: 700,
  margin: '0 0 12px',
  padding: '0',
};

export const logo = {
  padding: '0 4px 24px',
};

export const link = {
  color: brand.blue,
  textDecoration: 'underline',
};

export const footer = {
  maxWidth: '560px',
  margin: '0 auto',
  padding: '20px 32px 0',
};

export const button = {
  backgroundColor: brand.blue,
  borderRadius: '80px',
  color: '#ffffff',
  fontFamily,
  fontSize: '16px',
  fontWeight: 600,
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'inline-block',
  padding: '14px 28px',
};
