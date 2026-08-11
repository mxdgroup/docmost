import { Global, Module } from '@nestjs/common';
import { MxdTableRepo } from './mxd-table.repo';
import { MxdFieldRepo } from './mxd-field.repo';
import { MxdRecordRepo } from './mxd-record.repo';
import { MxdViewRepo } from './mxd-view.repo';
import { MxdRecordLinkRepo } from './mxd-record-link.repo';
import {
  MxdAutomationRuleRepo,
  MxdAutomationRunRepo,
} from './mxd-automation.repo';
import { MxdRecordHistoryRepo } from './mxd-record-history.repo';

// MXD data-platform repositories. Global so the feature services (E4) can inject
// them without re-importing per module, mirroring how the app's DatabaseModule
// exposes core repos globally.
@Global()
@Module({
  providers: [
    MxdTableRepo,
    MxdFieldRepo,
    MxdRecordRepo,
    MxdViewRepo,
    MxdRecordLinkRepo,
    MxdAutomationRuleRepo,
    MxdAutomationRunRepo,
    MxdRecordHistoryRepo,
  ],
  exports: [
    MxdTableRepo,
    MxdFieldRepo,
    MxdRecordRepo,
    MxdViewRepo,
    MxdRecordLinkRepo,
    MxdAutomationRuleRepo,
    MxdAutomationRunRepo,
    MxdRecordHistoryRepo,
  ],
})
export class MxdDataRepoModule {}
