import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { MxdActionRunner } from './mxd-action-runner.service';
import { ButtonConfig, validateButtonConfig } from '../buttons/button-config';

export interface ButtonRunResult {
  success: true;
  directives: { type: string; [k: string]: unknown }[];
}

// MXD data platform — button execution (roadmap §37-38). Authorizes WRITE on the
// button's table (same bar as editing a record), re-validates the config at run
// time, and delegates to the shared action runner. There is NO arbitrary code
// path; only the fixed action shapes run.
@Injectable()
export class MxdButtonService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
    private readonly actionRunner: MxdActionRunner,
  ) {}

  async run(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    recordId: string,
  ): Promise<ButtonRunResult> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeWrite(ctx, table);

    const buttonField = await this.fieldRepo.findById(
      ctx.workspaceId,
      tableId,
      fieldId,
    );
    if (!buttonField) throw new NotFoundException('Button not found');
    if (buttonField.type !== 'button') {
      throw new BadRequestException('Field is not a button');
    }

    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const config = validateButtonConfig(
      fields,
      buttonField.config as unknown as ButtonConfig,
    );

    const record = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!record) throw new NotFoundException('Record not found');

    const { directives } = await this.actionRunner.run(
      ctx,
      tableId,
      recordId,
      config.actions,
      { allowOpenUrl: true },
    );
    return { success: true, directives };
  }
}
