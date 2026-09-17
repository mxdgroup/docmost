import { createHmac, timingSafeEqual } from 'node:crypto';
import { FastifyInstance } from 'fastify';

export const HANDOFF_COOKIE = 'mxd_docs_handoff';
const PARAMS = ['ph_distinct_id', 'ph_exp', 'ph_sig'];

// Signal's wire format. This identity is for measurement, never authorization.
export function verifyHandoff(
  value: unknown,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): string | null {
  if (!secret || !value || typeof value !== 'object') return null;
  const { id, exp, sig } = value as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    id.length > 254 ||
    !/^[^\s@]+@[^\s@]+$/.test(id) ||
    typeof exp !== 'string' ||
    !/^[1-9]\d{8,11}$/.test(exp) ||
    typeof sig !== 'string' ||
    !/^[a-f\d]{32}$/i.test(sig)
  )
    return null;
  const expires = Number(exp);
  if (expires < now || expires > now + 3600) return null;
  const expected = createHmac('sha256', secret)
    .update(`${id}\n${exp}`)
    .digest('hex')
    .slice(0, 32);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig.toLowerCase()))
    ? id.trim().toLowerCase()
    : null;
}

export function analyticsDenied(
  cookies: Record<string, string | undefined> = {},
): boolean {
  return cookies.mxd_consent?.trim().toLowerCase() === 'denied';
}

export function installIdentityHandoff(
  app: FastifyInstance,
  secret: string,
  secure: boolean,
  enabled: boolean,
) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.method !== 'GET' || req.url.startsWith('/api/')) return;
    const url = new URL(req.url, 'https://docs.invalid');
    if (!PARAMS.some((name) => url.searchParams.has(name))) return;
    const value = {
      id: url.searchParams.get(PARAMS[0]),
      exp: url.searchParams.get(PARAMS[1]),
      sig: url.searchParams.get(PARAMS[2]),
    };
    const unique = PARAMS.every(
      (name) => url.searchParams.getAll(name).length === 1,
    );
    PARAMS.forEach((name) => url.searchParams.delete(name));
    reply.clearCookie(HANDOFF_COOKIE, { path: '/' });
    if (
      enabled &&
      unique &&
      !analyticsDenied(req.cookies) &&
      verifyHandoff(value, secret)
    ) {
      reply.setCookie(HANDOFF_COOKIE, JSON.stringify(value), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: 60,
      });
    }
    // A relative, same-origin redirect; never reflect an authority from the URL.
    reply
      .header('Cache-Control', 'private, no-store')
      .header('Referrer-Policy', 'no-referrer');
    return reply
      .code(303)
      .redirect('/' + url.pathname.replace(/^\/+/, '') + url.search);
  });
}
