import { Module } from '@nestjs/common';
import { MxdDataRepoModule } from '@docmost/db/repos/mxd-data/mxd-data-repo.module';
import { MxdDataController } from './mxd-data.controller';
import { MxdTableService } from './services/mxd-table.service';
import { MxdFieldService } from './services/mxd-field.service';
import { MxdRecordService } from './services/mxd-record.service';
import { MxdViewService } from './services/mxd-view.service';
import { MxdRelationService } from './services/mxd-relation.service';
import { MxdComputeService } from './services/mxd-compute.service';
import { MxdButtonService } from './services/mxd-button.service';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';
import { MxdAccessService } from './mxd-access.service';

// MXD data platform feature module (roadmap Phase 4). Repos come from the global
// MxdDataRepoModule; PageAccessService, SpaceAbilityFactory and PageRepo (used
// by MxdAccessService for authz) are all provided by global modules.
@Module({
  imports: [MxdDataRepoModule],
  controllers: [MxdDataController],
  providers: [
    MxdTableService,
    MxdFieldService,
    MxdRecordService,
    MxdViewService,
    MxdRelationService,
    MxdComputeService,
    MxdButtonService,
    MxdAccessService,
    MxdDataPlatformGuard,
  ],
  exports: [
    MxdTableService,
    MxdFieldService,
    MxdRecordService,
    MxdViewService,
    MxdRelationService,
  ],
})
export class MxdDataModule {}
