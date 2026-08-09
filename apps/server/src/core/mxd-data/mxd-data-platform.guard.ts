import {
  CanActivate,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';

// Gates the entire data-platform HTTP surface behind MXD_DATA_PLATFORM_ENABLED
// (default off — the feature ships dark, like the share flags, MXD-FORK.md). The
// server is the enforcement point; the client flag only drives UI affordances.
@Injectable()
export class MxdDataPlatformGuard implements CanActivate {
  constructor(private readonly environmentService: EnvironmentService) {}

  canActivate(): boolean {
    if (!this.environmentService.isMxdDataPlatformEnabled()) {
      throw new ForbiddenException('The data platform is not enabled');
    }
    return true;
  }
}
