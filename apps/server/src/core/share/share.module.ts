import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { TokenModule } from '../auth/token.module';
import { ShareSeoController } from './share-seo.controller';
import { TransclusionModule } from '../page/transclusion/transclusion.module';
import { CommentModule } from '../comment/comment.module';
import { ShareCommenterController } from './commenter/share-commenter.controller';
import { ShareCommenterService } from './commenter/share-commenter.service';

@Module({
  imports: [TokenModule, TransclusionModule, CommentModule],
  controllers: [ShareController, ShareSeoController, ShareCommenterController],
  providers: [ShareService, ShareCommenterService],
  exports: [ShareService],
})
export class ShareModule {}
