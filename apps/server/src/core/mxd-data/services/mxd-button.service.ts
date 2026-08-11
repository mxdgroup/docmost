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
import { MxdRecordService } from './mxd-record.service';
import { ButtonConfig, validateButtonConfig } from '../buttons/button-config';

export interface ButtonRunResult {
  success: true;
  // Client-side directives the server produced but does not execute (e.g. open a
  // URL). The client decides whether/how to act on them.
  directives: { type: string; [k: string]: unknown }[];
}

// MXD data platform — button execution (roadmap §37-38). Runs a button field's
// declarative actions server-side. Authorization: running a button requires
// WRITE on the button's table — the same bar as editing a record. There is NO
// arbitrary code path; only the fixed action shapes in button-config run.
@Injectable()
export class MxdButtonService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
    private readonly recordService: MxdRecordService,
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
    // Re-validate at run time — fields may have changed since the button was set.
    const config = validateButtonConfig(
      fields,
      buttonField.config as unknown as ButtonConfig,
    );
    const fieldsById = new Map(fields.map((f) => [f.id, f]));

    const record = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!record) throw new NotFoundException('Record not found');

    const directives: ButtonRunResult['directives'] = [];
    const patch: Record<string, unknown> = {};

    for (const action of config.actions) {
      switch (action.type) {
        case 'setField':
          patch[action.fieldId] = action.value;
          break;
        case 'clearField':
          patch[action.fieldId] = null;
          break;
        case 'setNow': {
          const f = fieldsById.get(action.fieldId);
          const iso = new Date().toISOString();
          patch[action.fieldId] = f?.type === 'date' ? iso.slice(0, 10) : iso;
          break;
        }
        case 'createRecord':
          // Executed immediately; validated/normalized by the record service.
          await this.recordService.createRecord(ctx, tableId, action.cells);
          break;
        case 'openUrl':
          directives.push({ type: 'openUrl', url: action.url });
          break;
      }
    }

    // Apply all cell mutations in one version-checked update (optimistic
    // concurrency — a stale record surfaces as a 409).
    if (Object.keys(patch).length > 0) {
      await this.recordService.updateRecord(
        ctx,
        tableId,
        recordId,
        record.version,
        patch,
      );
    }

    return { success: true, directives };
  }
}
