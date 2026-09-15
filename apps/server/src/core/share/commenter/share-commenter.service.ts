import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  ShareCommenter,
  ShareCommenterRepo,
} from '@docmost/db/repos/share/share-commenter.repo';
import { CommentRepo } from '@docmost/db/repos/comment/comment.repo';
import { TokenService } from '../../auth/services/token.service';
import { JwtType } from '../../auth/dto/jwt-payload';
import { MailService } from '../../../integrations/mail/mail.service';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { ShareService } from '../share.service';
import { CommentService } from '../../comment/comment.service';
import ShareCommenterSignInEmail from '@docmost/transactional/emails/share-commenter-sign-in-email';

export const COMMENTER_COOKIE = 'mxdCommenterToken';
export const COMMENTER_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;

// Sign-in links stay valid for 24 hours (product decision 2026-09-15); they
// are still single-use. The per-email cap uses its own short window.
const SIGN_IN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const LINK_CAP_WINDOW_MS = 15 * 60 * 1000;
const MAX_LINKS_PER_EMAIL_WINDOW = 3;
const MAX_CLAIMS_PER_SIGN_IN = 200;
// Only a real share page path may be the post-sign-in destination.
const RETURN_PATH_RE = /^\/share\/[A-Za-z0-9_-]{1,64}\/p\/[A-Za-z0-9_-]{1,300}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeEmail(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

// MXD: commenter accounts for public share links. A commenter is a verified
// email + display name — never a Docmost user — so signing in grants no
// workspace/space access; it only changes how share comments are attributed.
@Injectable()
export class ShareCommenterService {
  private readonly logger = new Logger(ShareCommenterService.name);

  constructor(
    private readonly commenterRepo: ShareCommenterRepo,
    private readonly commentRepo: CommentRepo,
    private readonly commentService: CommentService,
    private readonly shareService: ShareService,
    private readonly tokenService: TokenService,
    private readonly mailService: MailService,
    private readonly environmentService: EnvironmentService,
  ) {}

  // Emails a single-use sign-in link. Enumeration-safe: the caller gets the
  // same result whether or not an account exists, and whether or not the
  // per-email cap silently dropped the request.
  async requestSignInLink(opts: {
    workspaceId: string;
    shareId: string;
    pageId: string;
    email: string;
    name?: string;
    returnPath: string;
  }): Promise<void> {
    // Only reachable from a live, commentable share (same ladder + kill
    // switch as posting a guest comment).
    await this.shareService.validateGuestCommentAccess(
      opts.shareId,
      opts.pageId,
      opts.workspaceId,
    );
    if (!RETURN_PATH_RE.test(opts.returnPath)) {
      throw new ForbiddenException('Invalid return path');
    }

    const email = normalizeEmail(opts.email);
    const since = new Date(Date.now() - LINK_CAP_WINDOW_MS);
    const recent = await this.commenterRepo.countRecentSignInTokens(
      opts.workspaceId,
      email,
      since,
    );
    if (recent >= MAX_LINKS_PER_EMAIL_WINDOW) {
      this.logger.warn(`commenter sign-in link capped for an email address`);
      return;
    }

    const token = randomBytes(32).toString('base64url');
    await this.commenterRepo.insertSignInToken({
      workspaceId: opts.workspaceId,
      email,
      name: opts.name?.trim().slice(0, 50) || null,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SIGN_IN_TOKEN_TTL_MS),
    });

    const signInLink = `${this.environmentService.getAppUrl()}${opts.returnPath}?commenterSignIn=${encodeURIComponent(token)}`;
    await this.mailService.sendToQueue({
      to: email,
      subject: 'Your sign-in link',
      template: ShareCommenterSignInEmail({ signInLink }),
    });
  }

  // Consumes the emailed token, upserts the account, and moves any guest
  // comments this browser can prove it owns onto the account.
  async verifySignIn(opts: {
    workspaceId: string;
    token: string;
    guestComments?: { commentId: string; guestToken: string }[];
  }): Promise<{ commenter: ShareCommenter; sessionToken: string; claimed: number }> {
    if (!this.environmentService.isShareGuestCommentsEnabled()) {
      throw new ForbiddenException('Guest comments are disabled');
    }
    const commenter = await this.commenterRepo.consumeSignInToken(
      sha256(String(opts.token ?? '')),
      opts.workspaceId,
    );
    if (!commenter) {
      throw new ForbiddenException('This sign-in link is invalid or has expired');
    }

    let claimed = 0;
    for (const item of (opts.guestComments ?? []).slice(0, MAX_CLAIMS_PER_SIGN_IN)) {
      const comment = await this.commentRepo.findById(item.commentId);
      if (!comment || comment.workspaceId !== opts.workspaceId) continue;
      const owns = await this.commentService.isGuestCommentOwner(
        comment,
        item.guestToken,
      );
      if (!owns) continue;
      if (
        await this.commentRepo.claimGuestComment(
          comment.id,
          commenter.id,
          opts.workspaceId,
        )
      ) {
        claimed++;
      }
    }

    const sessionToken = await this.tokenService.generateShareCommenterToken({
      commenterId: commenter.id,
      workspaceId: opts.workspaceId,
    });
    return { commenter, sessionToken, claimed };
  }

  // Resolves the signed-in commenter from the session cookie, or null. Any
  // invalid/foreign/stale token is treated as "not signed in".
  async resolveFromRequest(
    req: any,
    workspaceId: string,
  ): Promise<ShareCommenter | null> {
    const token = req?.cookies?.[COMMENTER_COOKIE];
    if (!token) return null;
    try {
      const payload = await this.tokenService.verifyJwt(
        token,
        JwtType.SHARE_COMMENTER,
      );
      if (payload.workspaceId !== workspaceId || !payload.sub) return null;
      return (await this.commenterRepo.findById(payload.sub, workspaceId)) ?? null;
    } catch {
      return null;
    }
  }
}
