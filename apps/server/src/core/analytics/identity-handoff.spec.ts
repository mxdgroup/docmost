import fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createHmac } from 'crypto';
import {
  analyticsDenied,
  HANDOFF_COOKIE,
  installIdentityHandoff,
  verifyHandoff,
} from './identity-handoff';

const secret = 'handoff-secret';
const now = 1_800_000_000;
const value = {
  id: 'sarah@acme.com',
  exp: String(now),
  sig: '34e0e7b6d649068ab0b3cd9b3a9d50d3',
};
function signed(exp: number, id = value.id) {
  return {
    id,
    exp: String(exp),
    sig: createHmac('sha256', secret)
      .update(`${id}\n${exp}`)
      .digest('hex')
      .slice(0, 32),
  };
}

describe('Signal identity verification', () => {
  it('matches the fixed vector from Signal, without stripping tags or dots', () => {
    expect(verifyHandoff(value, secret, now)).toBe(value.id);
    expect(verifyHandoff(signed(now, 'S.Arah+q3@Acme.com'), secret, now)).toBe(
      's.arah+q3@acme.com',
    );
  });
  it.each([
    [{ ...value, id: 'attacker@example.com' }, secret, now],
    [value, 'wrong-secret', now],
    [value, '', now],
    [value, secret, now + 1],
    [signed(now + 3601), secret, now],
    [{ ...value, sig: 'é'.repeat(32) }, secret, now],
    [{ ...value, exp: '+1800000000' }, secret, now],
    [{ ...value, exp: '01800000000' }, secret, now],
    [null, secret, now],
    [{ id: [], exp: {}, sig: [] }, secret, now],
  ])('rejects tampering, expiry and malformed values', (input, key, clock) => {
    expect(verifyHandoff(input, key as string, clock as number)).toBeNull();
  });
  it('matches the fleet consent rule', () => {
    expect(analyticsDenied({ mxd_consent: ' DENIED ' })).toBe(true);
    expect(analyticsDenied({})).toBe(false);
  });
});

describe('handoff HTTP boundary', () => {
  async function app(enabled = true) {
    const instance = fastify();
    await instance.register(cookie);
    installIdentityHandoff(instance, secret, true, enabled);
    instance.get('/*', async () => 'page');
    return instance;
  }
  function query() {
    const v = signed(Math.floor(Date.now() / 1000) + 300);
    return new URLSearchParams({
      ph_distinct_id: v.id,
      ph_exp: v.exp,
      ph_sig: v.sig,
    });
  }
  it('redirects before rendering and stores only a short-lived host-only HttpOnly cookie', async () => {
    const server = await app();
    const result = await server.inject(
      `/share/secret/p/title-abcdefghijk?${query()}&keep=yes`,
    );
    expect(result.statusCode).toBe(303);
    expect(result.headers.location).toBe(
      '/share/secret/p/title-abcdefghijk?keep=yes',
    );
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.headers['referrer-policy']).toBe('no-referrer');
    const handoff = result.cookies.find(
      (c) => c.name === HANDOFF_COOKIE && c.value,
    );
    expect(handoff).toMatchObject({
      httpOnly: true,
      secure: true,
      maxAge: 60,
      sameSite: 'Lax',
    });
    expect(handoff.domain).toBeUndefined();
    expect(verifyHandoff(JSON.parse(handoff.value), secret)).toBe(value.id);
    await server.close();
  });
  it.each(['denied', 'unsigned', 'duplicate', 'disabled'])(
    'strips %s handoffs without adopting identity',
    async (mode) => {
      const server = await app(mode !== 'disabled');
      const params = query();
      if (mode === 'unsigned') params.delete('ph_sig');
      if (mode === 'duplicate')
        params.append('ph_distinct_id', 'other@example.com');
      const result = await server.inject({
        url: `/?${params}`,
        headers: mode === 'denied' ? { cookie: 'mxd_consent=denied' } : {},
      });
      expect(result.statusCode).toBe(303);
      expect(result.headers.location).toBe('/');
      expect(result.cookies.filter((c) => c.value)).toHaveLength(0);
      await server.close();
    },
  );
});
