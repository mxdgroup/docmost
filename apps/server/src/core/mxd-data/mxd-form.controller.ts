// MXD data platform — forms HTTP surface. Two controllers:
//  - MxdFormController: authenticated CRUD (managing a table's forms), guarded
//    exactly like the rest of the platform.
//  - MxdPublicFormController: the ANONYMOUS public path (fetch a form + submit).
//    No JwtAuthGuard — only the feature-flag guard + a per-IP throttle. All the
//    real protection lives in the service (enabled-only, whitelisted fields,
//    field-type validation, direct insert scoped to the form's table).
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { SHARE_PUBLIC_THROTTLER } from '../../integrations/throttle/throttler-names';
import { MxdContext } from './mxd-context';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';
import { MxdFormService } from './services/mxd-form.service';

class CreateFormDto {
  @IsString() tableId: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() fieldIds: string[];
  @IsOptional() @IsString() submitMessage?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
class FormIdDto {
  @IsString() tableId: string;
  @IsString() formId: string;
}
class UpdateFormDto extends FormIdDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() fieldIds?: string[];
  @IsOptional() @IsString() submitMessage?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@UseGuards(JwtAuthGuard, MxdDataPlatformGuard)
@Controller('mxd/forms')
export class MxdFormController {
  constructor(private readonly formService: MxdFormService) {}

  private ctx(user: User, workspace: Workspace): MxdContext {
    return { workspaceId: workspace.id, userId: user.id, user };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  create(
    @Body() dto: CreateFormDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.formService.createForm(this.ctx(user, ws), dto.tableId, {
      title: dto.title,
      description: dto.description,
      fieldIds: dto.fieldIds,
      submitMessage: dto.submitMessage,
      enabled: dto.enabled,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('list')
  list(
    @Body() dto: { tableId: string },
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.formService.listForms(this.ctx(user, ws), dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  update(
    @Body() dto: UpdateFormDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    return this.formService.updateForm(
      this.ctx(user, ws),
      dto.tableId,
      dto.formId,
      {
        title: dto.title,
        description: dto.description,
        fieldIds: dto.fieldIds,
        submitMessage: dto.submitMessage,
        enabled: dto.enabled,
      },
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(
    @Body() dto: FormIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() ws: Workspace,
  ) {
    await this.formService.deleteForm(this.ctx(user, ws), dto.tableId, dto.formId);
    return { success: true };
  }
}

class PublicFormKeyDto {
  @IsString() key: string;
}
class SubmitFormDto {
  @IsString() key: string;
  @IsObject() values: Record<string, unknown>;
}

// PUBLIC — no auth. Feature-flag gated + per-IP throttled.
@UseGuards(MxdDataPlatformGuard, ThrottlerGuard)
@Controller('mxd/public/forms')
export class MxdPublicFormController {
  constructor(private readonly formService: MxdFormService) {}

  @HttpCode(HttpStatus.OK)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 60 } })
  @Post('get')
  get(@Body() dto: PublicFormKeyDto) {
    return this.formService.getPublicForm(dto.key);
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @Post('submit')
  submit(@Body() dto: SubmitFormDto) {
    return this.formService.submitForm(dto.key, dto.values);
  }
}
