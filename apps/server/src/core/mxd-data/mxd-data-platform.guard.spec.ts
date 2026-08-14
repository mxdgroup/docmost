import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';
import { EnvironmentService } from '../../integrations/environment/environment.service';

function make(isEnabled: boolean) {
  const environmentService = {
    isMxdDataPlatformEnabled: jest.fn().mockReturnValue(isEnabled),
  };
  const guard = new MxdDataPlatformGuard(
    environmentService as unknown as EnvironmentService,
  );
  // Minimal ExecutionContext stand-in — MxdDataPlatformGuard.canActivate ignores
  // it entirely (the decision is based solely on the feature flag), but we pass
  // it through the CanActivate call site as NestJS would.
  const context = {} as ExecutionContext;
  return { guard, environmentService, context };
}

describe('MxdDataPlatformGuard', () => {
  it('throws ForbiddenException when the data platform feature flag is disabled', () => {
    const { guard, context, environmentService } = make(false);
    expect(() => (guard.canActivate as any)(context)).toThrow(
      ForbiddenException,
    );
    expect(environmentService.isMxdDataPlatformEnabled).toHaveBeenCalled();
  });

  it('returns true when the data platform feature flag is enabled', () => {
    const { guard, context, environmentService } = make(true);
    expect((guard.canActivate as any)(context)).toBe(true);
    expect(environmentService.isMxdDataPlatformEnabled).toHaveBeenCalled();
  });
});
