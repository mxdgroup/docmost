jest.mock('../share/commenter/share-commenter.service', () => ({
  ShareCommenterService: class {},
}));
import {
  AnalyticsController,
  AnalyticsIdentityGuard,
} from './analytics.controller';
import { HANDOFF_COOKIE } from './identity-handoff';
import { createHmac } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

describe('Docs analytics identity scope', () => {
  const environment = {
    getPostHogKey: () => 'project',
    getPostHogHost: () => 'https://n.mxd.digital',
    getIdentityParamSecret: () => 'secret',
  };
  const commenters = { resolveFromRequest: jest.fn() };
  const controller = new AnalyticsController(
    environment as any,
    commenters as any,
  );
  const reply = {
    header: jest.fn().mockReturnThis(),
    clearCookie: jest.fn(),
  } as any;
  const request = () => ({
    raw: { workspaceId: 'workspace' },
    cookies: {} as Record<string, string>,
    user: null as any,
  });
  beforeEach(() => jest.clearAllMocks());
  it('takes authenticated membership over a link and returns only allowed profile fields', async () => {
    const req = request();
    req.user = {
      user: { email: 'Member@Example.com', name: 'Member', password: 'secret' },
    };
    expect(await controller.identity(req, reply)).toEqual({
      identity: {
        email: 'member@example.com',
        name: 'Member',
        source: 'member',
      },
    });
    expect(commenters.resolveFromRequest).not.toHaveBeenCalled();
    expect(reply.clearCookie).toHaveBeenCalledWith(HANDOFF_COOKIE, {
      path: '/',
    });
  });
  it('resolves commenter sessions inside this workspace', async () => {
    const req = request();
    commenters.resolveFromRequest.mockResolvedValueOnce({
      name: 'Reader',
      email: 'Reader@example.com',
    });
    expect((await controller.identity(req, reply)).identity.source).toBe(
      'commenter',
    );
    expect(commenters.resolveFromRequest).toHaveBeenCalledWith(
      req,
      'workspace',
    );
  });
  it('validates the handoff again before returning its identity, without issuing an auth cookie', async () => {
    const req = request();
    const id = 'reader@example.com';
    const exp = String(Math.floor(Date.now() / 1000) + 300);
    const sig = createHmac('sha256', 'secret')
      .update(`${id}\n${exp}`)
      .digest('hex')
      .slice(0, 32);
    req.cookies[HANDOFF_COOKIE] = JSON.stringify({ id, exp, sig });
    expect(await controller.identity(req, reply)).toEqual({
      identity: { email: id, source: 'signal' },
    });
    req.cookies[HANDOFF_COOKIE] = JSON.stringify({
      id: 'other@example.com',
      exp,
      sig,
    });
    expect(await controller.identity(req, reply)).toEqual({ identity: null });
  });
  it('discards handoffs and returns no identity when consent is denied', async () => {
    const req = request();
    req.cookies.mxd_consent = 'denied';
    req.user = { user: { email: 'member@example.com' } };
    expect(await controller.identity(req, reply)).toEqual({ identity: null });
    expect(reply.clearCookie).toHaveBeenCalled();
  });
  it('does not turn infrastructure errors into anonymous identities', () => {
    const guard = new AnalyticsIdentityGuard();
    expect(
      guard.handleRequest(new UnauthorizedException(), null, null, null),
    ).toBeNull();
    expect(() =>
      guard.handleRequest(new Error('database unavailable'), null, null, null),
    ).toThrow('database unavailable');
  });
});
