import {
  Controller,
  ExecutionContext,
  HttpCode,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FastifyReply } from 'fastify';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { ShareCommenterService } from '../share/commenter/share-commenter.service';
import { SHARE_PUBLIC_THROTTLER } from '../../integrations/throttle/throttler-names';
import {
  analyticsDenied,
  HANDOFF_COOKIE,
  verifyHandoff,
} from './identity-handoff';

@Injectable()
export class AnalyticsIdentityGuard extends AuthGuard('jwt') {
  handleRequest<TUser = any>(
    err: any,
    user: TUser,
    _info: any,
    _context: ExecutionContext,
  ): TUser {
    // Invalid/expired sessions are anonymous here. Infrastructure failures still fail closed.
    if (err && !(err instanceof UnauthorizedException)) throw err;
    return user || null;
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly environment: EnvironmentService,
    private readonly commenters: ShareCommenterService,
  ) {}

  @Post('identity')
  @HttpCode(200)
  @UseGuards(AnalyticsIdentityGuard, ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 120 } })
  async identity(
    @Req() req: any,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'private, no-store');
    reply.clearCookie(HANDOFF_COOKIE, { path: '/' });
    if (
      !this.environment.getPostHogKey() ||
      !this.environment.getPostHogHost() ||
      analyticsDenied(req.cookies)
    )
      return { identity: null };
    const member = req.user?.user;
    if (member)
      return {
        identity: {
          email: member.email.trim().toLowerCase(),
          name: member.name,
          source: 'member',
        },
      };
    const workspaceId = req.raw.workspaceId;
    const commenter = workspaceId
      ? await this.commenters.resolveFromRequest(req, workspaceId)
      : null;
    if (commenter)
      return {
        identity: {
          email: commenter.email.trim().toLowerCase(),
          name: commenter.name,
          source: 'commenter',
        },
      };
    let value: unknown;
    try {
      value = JSON.parse(req.cookies?.[HANDOFF_COOKIE] || 'null');
    } catch {
      return { identity: null };
    }
    const email = verifyHandoff(
      value,
      this.environment.getIdentityParamSecret(),
    );
    return { identity: email ? { email, source: 'signal' } : null };
  }
}
