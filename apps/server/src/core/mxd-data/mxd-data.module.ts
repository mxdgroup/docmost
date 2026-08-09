import { Module } from '@nestjs/common';
import { MxdDataRepoModule } from '@docmost/db/repos/mxd-data/mxd-data-repo.module';
import { MxdDataController } from './mxd-data.controller';
import { MxdTableService } from './services/mxd-table.service';
import { MxdFieldService } from './services/mxd-field.service';
import { MxdRecordService } from './services/mxd-record.service';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';

// MXD data platform feature module (roadmap Phase 4). Repos come from the global
// MxdDataRepoModule; EnvironmentService (for the feature guard) is global.
@Module({
  imports: [MxdDataRepoModule],
  controllers: [MxdDataController],
  providers: [
    MxdTableService,
    MxdFieldService,
    MxdRecordService,
    MxdDataPlatformGuard,
  ],
  exports: [MxdTableService, MxdFieldService, MxdRecordService],
})
export class MxdDataModule {}
