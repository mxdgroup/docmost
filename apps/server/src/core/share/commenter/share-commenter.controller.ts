import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { SHARE_PUBLIC_THROTTLER } from '../../../integrations/throttle/throttler-names';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import {
  COMMENTER_COOKIE,
  COMMENTER_COOKIE_MAX_AGE_S,
  ShareCommenterService,
} from './share-commenter.service';
import {
  CommenterSignInRequestDto,
  CommenterSignInVerifyDto,
} from './share-commenter.dto';

// MXD: commenter-account sign-in for public share links (email magic link).
// All routes are public and throttled; none of them grant Docmost access.
@UseGuards(JwtAuthGuard)
@Controller('shares/commenter')
export class ShareCommenterController {
  constructor(
    private readonly commenterService: ShareCommenterService,
    private readonly environmentService: EnvironmentService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @Post('request-link')
  async requestLink(
    @Body() dto: CommenterSignInRequestDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.commenterService.requestSignInLink({
      workspaceId: workspace.id,
      shareId: dto.shareId,
      pageId: dto.pageId,
      email: dto.email,
      name: dto.name,
      returnPath: dto.returnPath,
    });
    // Same answer whether or not the address has an account.
    return { sent: true };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Body() dto: CommenterSignInVerifyDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { commenter, sessionToken, claimed } =
      await this.commenterService.verifySignIn({
        workspaceId: workspace.id,
        token: dto.token,
        guestComments: dto.guestComments,
      });
    res.setCookie(COMMENTER_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COMMENTER_COOKIE_MAX_AGE_S,
      secure: this.environmentService.isHttps(),
    });
    return {
      commenter: { id: commenter.id, name: commenter.name, email: commenter.email },
      claimed,
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 60 } })
  @HttpCode(HttpStatus.OK)
  @Post('me')
  async me(@AuthWorkspace() workspace: Workspace, @Req() req: any) {
    const commenter = await this.commenterService.resolveFromRequest(
      req,
      workspace.id,
    );
    return {
      commenter: commenter
        ? { id: commenter.id, name: commenter.name, email: commenter.email }
        : null,
    };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('sign-out')
  async signOut(@Res({ passthrough: true }) res: FastifyReply) {
    res.clearCookie(COMMENTER_COOKIE, { path: '/' });
    return { signedOut: true };
  }
}
