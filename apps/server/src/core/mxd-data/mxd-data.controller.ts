// MXD data platform — HTTP surface (roadmap §14). Thin controllers: auth,
// input schema, service call, error mapping. All business logic lives in the
// services. Every capability is a plain endpoint (agent-native parity).
//
// SECURITY SCOPE (current increment): gated behind MXD_DATA_PLATFORM_ENABLED
// (default off) and scoped to the authenticated workspace. Finer-grained
// space/table/view/record authorization (roadmap §17) is the NEXT required
// increment and MUST land before this flag is enabled in any shared workspace —
// today a workspace member could reach a table in a space they aren't a member
// of. Tracked in the data-platform ledger.
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { MxdContext } from './mxd-context';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';
import { MxdTableService } from './services/mxd-table.service';
import { MxdFieldService } from './services/mxd-field.service';
import { MxdRecordService } from './services/mxd-record.service';

class CreateTableDto {
  @IsString() pageId: string;
  @IsOptional() @IsString() title?: string;
}
class TableIdDto {
  @IsString() tableId: string;
}
class ListTablesDto {
  @IsString() spaceId: string;
}
class RenameTableDto {
  @IsString() tableId: string;
  @IsString() title: string;
}
class AddFieldDto {
  @IsString() tableId: string;
  @IsString() name: string;
  @IsString() type: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class FieldIdDto {
  @IsString() tableId: string;
  @IsString() fieldId: string;
}
class RenameFieldDto extends FieldIdDto {
  @IsString() name: string;
}
class ReorderFieldDto extends FieldIdDto {
  @IsInt() position: number;
}
class FieldConfigDto extends FieldIdDto {
  @IsObject() config: Record<string, unknown>;
}
class ChangeTypeDto extends FieldIdDto {
  @IsString() type: string;
  @IsOptional() clearIncompatible?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class CreateRecordDto {
  @IsString() tableId: string;
  @IsObject() cells: Record<string, unknown>;
}
class RecordIdDto {
  @IsString() tableId: string;
  @IsString() recordId: string;
}
class ListRecordsDto {
  @IsString() tableId: string;
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsInt() @Min(0) offset?: number;
}
class UpdateRecordDto extends RecordIdDto {
  @IsInt() version: number;
  @IsObject() cells: Record<string, unknown>;
}
class DeleteRecordDto extends RecordIdDto {
  @IsInt() version: number;
}

@UseGuards(JwtAuthGuard, MxdDataPlatformGuard)
@Controller('mxd')
export class MxdDataController {
  constructor(
    private readonly tableService: MxdTableService,
    private readonly fieldService: MxdFieldService,
    private readonly recordService: MxdRecordService,
  ) {}

  private ctx(user: User, workspace: Workspace): MxdContext {
    return { workspaceId: workspace.id, userId: user.id, user };
  }

  // ---- tables
  @HttpCode(HttpStatus.OK)
  @Post('tables/create')
  createTable(
    @Body() dto: CreateTableDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.tableService.createTable(this.ctx(user, ws), dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('tables/get')
  getTable(
    @Body() dto: TableIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.tableService.getTable(this.ctx(user, ws), dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('tables/list')
  listTables(
    @Body() dto: ListTablesDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.tableService.listTables(this.ctx(user, ws), dto.spaceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('tables/rename')
  renameTable(
    @Body() dto: RenameTableDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.tableService.renameTable(
      this.ctx(user, ws),
      dto.tableId,
      dto.title,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('tables/archive')
  async archiveTable(
    @Body() dto: TableIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    await this.tableService.archiveTable(this.ctx(user, ws), dto.tableId);
    return { success: true };
  }

  // ---- fields
  @HttpCode(HttpStatus.OK)
  @Post('fields/list')
  listFields(
    @Body() dto: TableIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.listFields(this.ctx(user, ws), dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/add')
  addField(
    @Body() dto: AddFieldDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.addField(this.ctx(user, ws), dto.tableId, {
      name: dto.name,
      type: dto.type,
      config: dto.config,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/rename')
  renameField(
    @Body() dto: RenameFieldDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.renameField(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
      dto.name,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/reorder')
  reorderField(
    @Body() dto: ReorderFieldDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.reorderField(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
      dto.position,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/config')
  updateFieldConfig(
    @Body() dto: FieldConfigDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.updateConfig(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
      dto.config,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/change-type')
  changeType(
    @Body() dto: ChangeTypeDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.fieldService.changeType(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
      dto.type,
      { clearIncompatible: dto.clearIncompatible, config: dto.config },
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields/delete')
  async deleteField(
    @Body() dto: FieldIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    await this.fieldService.deleteField(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
    );
    return { success: true };
  }

  // ---- records
  @HttpCode(HttpStatus.OK)
  @Post('records/create')
  createRecord(
    @Body() dto: CreateRecordDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.createRecord(
      this.ctx(user, ws),
      dto.tableId,
      dto.cells,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/get')
  getRecord(
    @Body() dto: RecordIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.getRecord(
      this.ctx(user, ws),
      dto.tableId,
      dto.recordId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/list')
  listRecords(
    @Body() dto: ListRecordsDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.listRecords(this.ctx(user, ws), dto.tableId, {
      limit: dto.limit,
      offset: dto.offset,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/update')
  updateRecord(
    @Body() dto: UpdateRecordDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.updateRecord(
      this.ctx(user, ws),
      dto.tableId,
      dto.recordId,
      dto.version,
      dto.cells,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/delete')
  async deleteRecord(
    @Body() dto: DeleteRecordDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    await this.recordService.deleteRecord(
      this.ctx(user, ws),
      dto.tableId,
      dto.recordId,
      dto.version,
    );
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/duplicate')
  duplicateRecord(
    @Body() dto: RecordIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.duplicateRecord(
      this.ctx(user, ws),
      dto.tableId,
      dto.recordId,
    );
  }
}
