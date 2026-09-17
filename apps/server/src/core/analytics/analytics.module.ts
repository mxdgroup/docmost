import { Module } from '@nestjs/common';
import { ShareModule } from '../share/share.module';
import {
  AnalyticsController,
  AnalyticsIdentityGuard,
} from './analytics.controller';

@Module({
  imports: [ShareModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsIdentityGuard],
})
export class AnalyticsModule {}
