import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';

// The real gateway drags in ESM-only collab deps jest can't parse.
jest.mock('../../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: class {},
}));

import { ShareCommenterService, COMMENTER_COOKIE } from './share-commenter.service';
import { TokenService } from '../../auth/services/token.service';
import { JwtType } from '../../auth/dto/jwt-payload';

const WS = '00000000-0000-0000-0000-00000000000a';
const OTHER_WS = '00000000-0000-0000-0000-00000000000b';
const SECRET = 'test-secret-for-commenter-spec-0123456789';
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

function build(opts: {
  recentTokens?: number;
  consume?: any;
  comments?: Record<string, any>;
  owned?: Set<string>;
  commenterById?: any;
  accessError?: Error;
  flag?: boolean;
} = {}) {
  const environmentService = {
    getAppSecret: () => SECRET,
    getAppUrl: () => 'https://docs.example.test',
    isShareGuestCommentsEnabled: () => opts.flag ?? true,
  };
  const tokenService = new TokenService(
    new JwtService({ secret: SECRET }),
    environmentService as any,
  );
  const commenterRepo = {
    countRecentSignInTokens: jest.fn().mockResolvedValue(opts.recentTokens ?? 0),
    insertSignInToken: jest.fn().mockResolvedValue(undefined),
    consumeSignInToken: jest.fn().mockResolvedValue(opts.consume ?? null),
    findById: jest.fn().mockResolvedValue(opts.commenterById ?? undefined),
  };
  const commentRepo = {
    findById: jest.fn(async (id: string) => opts.comments?.[id] ?? null),
    claimGuestComment: jest.fn().mockResolvedValue(true),
  };
  const commentService = {
    isGuestCommentOwner: jest.fn(async (c: any, token: string) =>
      (opts.owned ?? new Set()).has(`${c.id}:${token}`),
    ),
  };
  const shareService = {
    validateGuestCommentAccess: jest.fn(async () => {
      if (opts.accessError) throw opts.accessError;
      return { share: {}, page: {} };
    }),
  };
  const mailService = { sendToQueue: jest.fn().mockResolvedValue(undefined) };
  const service = new ShareCommenterService(
    commenterRepo as any,
    commentRepo as any,
    commentService as any,
    shareService as any,
    tokenService,
    mailService as any,
    environmentService as any,
  );
  return { service, commenterRepo, commentRepo, mailService, shareService, tokenService };
}

const requestOpts = {
  workspaceId: WS,
  shareId: 'sharekey01',
  pageId: 'pageSlugId',
  email: '  Sam@Example.CO ',
  name: 'Sam Kelly',
  returnPath: '/share/sharekey01/p/kitchens-brief-pageSlugId',
};

describe('ShareCommenterService.requestSignInLink', () => {
  it('stores only a hash of a 15-minute token and emails a link back to the share page', async () => {
    const { service, commenterRepo, mailService } = build();
    await service.requestSignInLink(requestOpts);

    const stored = commenterRepo.insertSignInToken.mock.calls[0][0];
    expect(stored.email).toBe('sam@example.co'); // normalized
    expect(stored.name).toBe('Sam Kelly');
    const ttl = stored.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(15 * 60 * 1000);

    const mail = mailService.sendToQueue.mock.calls[0][0];
    expect(mail.to).toBe('sam@example.co');
    const html = JSON.stringify(mail);
    const match = html.match(/commenterSignIn=([A-Za-z0-9_-]+)/);
    expect(match).not.toBeNull();
    expect(html).toContain(
      'https://docs.example.test/share/sharekey01/p/kitchens-brief-pageSlugId?commenterSignIn=',
    );
    expect(stored.tokenHash).toBe(sha256(decodeURIComponent(match![1])));
    expect(stored.tokenHash).not.toBe(match![1]);
  });

  it('only works from a live, commentable share (same access ladder as guest comments)', async () => {
    const { service, commenterRepo, mailService } = build({
      accessError: new ForbiddenException('This link does not allow comments'),
    });
    await expect(service.requestSignInLink(requestOpts)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(commenterRepo.insertSignInToken).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('refuses a return path that is not a share page (no open redirect)', async () => {
    const { service, mailService } = build();
    for (const returnPath of [
      'https://evil.test/share/x/p/y',
      '//evil.test/share/x/p/y',
      '/home',
      '/share/x/p/y?next=https://evil.test',
      '/share/../../login',
    ]) {
      await expect(
        service.requestSignInLink({ ...requestOpts, returnPath }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('silently caps links per email (same response, no email sent)', async () => {
    const { service, commenterRepo, mailService } = build({ recentTokens: 3 });
    await expect(service.requestSignInLink(requestOpts)).resolves.toBeUndefined();
    expect(commenterRepo.insertSignInToken).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });
});

describe('ShareCommenterService.verifySignIn', () => {
  const commenter = { id: 'cmtr-1', workspaceId: WS, email: 'sam@example.co', name: 'Sam Kelly' };

  it('rejects an invalid, expired, or already-used token', async () => {
    const { service } = build({ consume: null });
    await expect(
      service.verifySignIn({ workspaceId: WS, token: 'nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('looks the token up by hash, never by its raw value', async () => {
    const { service, commenterRepo } = build({ consume: commenter });
    await service.verifySignIn({ workspaceId: WS, token: 'raw-token' });
    expect(commenterRepo.consumeSignInToken).toHaveBeenCalledWith(sha256('raw-token'), WS);
  });

  it('moves only guest comments this browser proves it owns, in this workspace', async () => {
    const { service, commentRepo } = build({
      consume: commenter,
      comments: {
        mine: { id: 'mine', workspaceId: WS, creatorId: null },
        notMine: { id: 'notMine', workspaceId: WS, creatorId: null },
        otherWs: { id: 'otherWs', workspaceId: OTHER_WS, creatorId: null },
      },
      owned: new Set(['mine:tok-a', 'otherWs:tok-c']),
    });
    const result = await service.verifySignIn({
      workspaceId: WS,
      token: 'raw-token',
      guestComments: [
        { commentId: 'mine', guestToken: 'tok-a' },
        { commentId: 'notMine', guestToken: 'guessed' },
        { commentId: 'otherWs', guestToken: 'tok-c' },
        { commentId: 'missing', guestToken: 'x' },
      ],
    });
    expect(result.claimed).toBe(1);
    expect(commentRepo.claimGuestComment).toHaveBeenCalledTimes(1);
    expect(commentRepo.claimGuestComment).toHaveBeenCalledWith('mine', 'cmtr-1', WS);
  });

  it('issues a SHARE_COMMENTER session that Docmost access checks reject', async () => {
    const { service, tokenService } = build({ consume: commenter });
    const { sessionToken } = await service.verifySignIn({ workspaceId: WS, token: 't' });
    const payload = await tokenService.verifyJwt(sessionToken, JwtType.SHARE_COMMENTER);
    expect(payload).toEqual(
      expect.objectContaining({ sub: 'cmtr-1', workspaceId: WS, type: 'share_commenter' }),
    );
    // Not a user id, and not usable as an access/collab token.
    await expect(tokenService.verifyJwt(sessionToken, JwtType.ACCESS)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(tokenService.verifyJwt(sessionToken, JwtType.COLLAB)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('is disabled with the guest-comments kill switch', async () => {
    const { service } = build({ consume: commenter, flag: false });
    await expect(
      service.verifySignIn({ workspaceId: WS, token: 't' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ShareCommenterService.resolveFromRequest', () => {
  const commenter = { id: 'cmtr-1', workspaceId: WS, email: 'sam@example.co', name: 'Sam Kelly' };

  it('returns the commenter for a valid session cookie', async () => {
    const { service, tokenService } = build({ commenterById: commenter });
    const token = await tokenService.generateShareCommenterToken({ commenterId: 'cmtr-1', workspaceId: WS });
    await expect(
      service.resolveFromRequest({ cookies: { [COMMENTER_COOKIE]: token } }, WS),
    ).resolves.toEqual(commenter);
  });

  it('treats a missing, foreign-workspace, wrong-type or forged cookie as signed out', async () => {
    const { service, tokenService } = build({ commenterById: commenter });
    const foreign = await tokenService.generateShareCommenterToken({ commenterId: 'cmtr-1', workspaceId: OTHER_WS });
    const collab = await tokenService.generateShareCollabToken({ shareId: 's', pageId: 'p', workspaceId: WS });
    const forged = new JwtService({ secret: 'wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxx' }).sign({
      sub: 'cmtr-1', workspaceId: WS, type: 'share_commenter',
    });
    for (const cookies of [{}, { [COMMENTER_COOKIE]: foreign }, { [COMMENTER_COOKIE]: collab }, { [COMMENTER_COOKIE]: forged }]) {
      await expect(service.resolveFromRequest({ cookies }, WS)).resolves.toBeNull();
    }
  });

  it('treats a deleted account as signed out', async () => {
    const { service, tokenService } = build({ commenterById: undefined });
    const token = await tokenService.generateShareCommenterToken({ commenterId: 'gone', workspaceId: WS });
    await expect(
      service.resolveFromRequest({ cookies: { [COMMENTER_COOKIE]: token } }, WS),
    ).resolves.toBeNull();
  });
});
