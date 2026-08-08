import { Global, Module } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import { PageAccessManagementService } from './page-access-management.service';
import { PageAccessController } from './page-access.controller';

@Global()
@Module({
  controllers: [PageAccessController],
  providers: [PageAccessService, PageAccessManagementService],
  exports: [PageAccessService, PageAccessManagementService],
})
export class PageAccessModule {}
