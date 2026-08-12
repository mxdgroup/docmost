// MXD data platform — PUBLIC read surface for an embedded table on a public
// share. No JwtAuthGuard: the share (resolved by key in the service) is the
// authorization. Feature-flag gated + per-IP throttled. Read-only.
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SHARE_PUBLIC_THROTTLER } from '../../integrations/throttle/throttler-names';
import { MxdDataPlatformGuard } from './mxd-data-platform.guard';
import { MxdPublicDataService } from './services/mxd-public-data.service';

class ShareTableDto {
  @IsString() shareKey: string;
  @IsString() tableId: string;
}
class ShareRecordsDto extends ShareTableDto {
  @IsOptional() @IsString() viewId?: string;
  @IsOptional() @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsInt() @Min(0) offset?: number;
}

@UseGuards(MxdDataPlatformGuard, ThrottlerGuard)
@Throttle({ [SHARE_PUBLIC_THROTTLER]: { ttl: 60_000, limit: 120 } })
@Controller('mxd/public/data')
export class MxdPublicDataController {
  constructor(private readonly publicData: MxdPublicDataService) {}

  @HttpCode(HttpStatus.OK)
  @Post('table')
  table(@Body() dto: ShareTableDto) {
    return this.publicData.getTable(dto.shareKey, dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('fields')
  fields(@Body() dto: ShareTableDto) {
    return this.publicData.listFields(dto.shareKey, dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views')
  views(@Body() dto: ShareTableDto) {
    return this.publicData.listViews(dto.shareKey, dto.tableId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records')
  records(@Body() dto: ShareRecordsDto) {
    return this.publicData.queryRecords(dto.shareKey, dto.tableId, {
      viewId: dto.viewId,
      limit: dto.limit,
      offset: dto.offset,
    });
  }
}
