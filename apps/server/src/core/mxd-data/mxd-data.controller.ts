// MXD data platform — HTTP surface (roadmap §14). Thin controllers: auth,
// input schema, service call, error mapping. All business logic lives in the
// services. Every capability is a plain endpoint (agent-native parity).
//
// SECURITY: gated behind MXD_DATA_PLATFORM_ENABLED (default off). Authorization
// is enforced per operation by MxdAccessService — every read authorizes VIEW and
// every write authorizes EDIT against the table's home page/space using
// Docmost's own PageAccessService/SpaceAbilityFactory, so a workspace member
// cannot reach a table/record in a space or restricted page they can't access.
// (Public/anonymous share access to embedded tables is a separate, not-yet-built
// path; the authenticated surface here refuses anonymous callers.)
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
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
import { MxdViewService } from './services/mxd-view.service';
import { MxdRelationService } from './services/mxd-relation.service';
import { MxdButtonService } from './services/mxd-button.service';

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
  @IsOptional() @IsBoolean() clearIncompatible?: boolean;
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
class QueryRecordsDto {
  @IsString() tableId: string;
  @IsOptional() @IsString() viewId?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
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
class CreateViewDto {
  @IsString() tableId: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class ViewIdDto {
  @IsString() tableId: string;
  @IsString() viewId: string;
}
class RenameViewDto extends ViewIdDto {
  @IsString() name: string;
}
class UpdateViewDto extends ViewIdDto {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
}
class ReorderViewDto extends ViewIdDto {
  @IsInt() position: number;
}
class RelationEdgeDto {
  @IsString() tableId: string;
  @IsString() fieldId: string;
  @IsString() fromRecordId: string;
  @IsString() toRecordId: string;
}
class RelationListDto {
  @IsString() tableId: string;
  @IsString() fieldId: string;
  @IsString() recordId: string;
}
class RunButtonDto {
  @IsString() tableId: string;
  @IsString() fieldId: string;
  @IsString() recordId: string;
}

@UseGuards(JwtAuthGuard, MxdDataPlatformGuard)
@Controller('mxd')
export class MxdDataController {
  constructor(
    private readonly tableService: MxdTableService,
    private readonly fieldService: MxdFieldService,
    private readonly recordService: MxdRecordService,
    private readonly viewService: MxdViewService,
    private readonly relationService: MxdRelationService,
    private readonly buttonService: MxdButtonService,
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
  @Post('records/query')
  queryRecords(
    @Body() dto: QueryRecordsDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.recordService.queryRecords(this.ctx(user, ws), dto.tableId, {
      viewId: dto.viewId,
      config: dto.config as any,
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

  // ---- views
  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  createView(
    @Body() dto: CreateViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.createView(this.ctx(user, ws), dto.tableId, {
      name: dto.name,
      type: dto.type,
      config: dto.config,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/list')
  listViews(
    @Body() dto: TableIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.listViews(this.ctx(user, ws), dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/get')
  getView(
    @Body() dto: ViewIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.getView(this.ctx(user, ws), dto.tableId, dto.viewId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/rename')
  renameView(
    @Body() dto: RenameViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.renameView(
      this.ctx(user, ws),
      dto.tableId,
      dto.viewId,
      dto.name,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/config')
  updateView(
    @Body() dto: UpdateViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.updateConfig(
      this.ctx(user, ws),
      dto.tableId,
      dto.viewId,
      { type: dto.type, config: dto.config },
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/reorder')
  reorderView(
    @Body() dto: ReorderViewDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.viewService.reorderView(
      this.ctx(user, ws),
      dto.tableId,
      dto.viewId,
      dto.position,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/delete')
  async deleteView(
    @Body() dto: ViewIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    await this.viewService.deleteView(
      this.ctx(user, ws),
      dto.tableId,
      dto.viewId,
    );
    return { success: true };
  }

  // ---- relations
  @HttpCode(HttpStatus.OK)
  @Post('relations/link')
  linkRelation(
    @Body() dto: RelationEdgeDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.relationService.link(this.ctx(user, ws), dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('relations/unlink')
  unlinkRelation(
    @Body() dto: RelationEdgeDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.relationService.unlink(this.ctx(user, ws), dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('relations/list')
  listRelated(
    @Body() dto: RelationListDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.relationService.listRelated(this.ctx(user, ws), dto);
  }

  // ---- buttons
  @HttpCode(HttpStatus.OK)
  @Post('buttons/run')
  runButton(
    @Body() dto: RunButtonDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.buttonService.run(
      this.ctx(user, ws),
      dto.tableId,
      dto.fieldId,
      dto.recordId,
    );
  }
}
