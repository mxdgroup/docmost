import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ShareMode } from '../share-mode';

export class CreateShareDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsBoolean()
  @IsOptional()
  includeSubPages: boolean;

  @IsOptional()
  @IsBoolean()
  searchIndexing: boolean;

  @IsOptional()
  @IsIn([ShareMode.VIEW, ShareMode.COMMENT, ShareMode.EDIT])
  mode?: string;
}

export class UpdateShareDto extends CreateShareDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsString()
  @IsOptional()
  pageId: string;
}

export class ShareIdDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;
}

export class SpaceIdDto {
  @IsUUID()
  spaceId: string;
}

export class ShareInfoDto {
  @IsString()
  @IsOptional()
  shareId?: string;

  @IsString()
  @IsOptional()
  pageId: string;
}

export class SharePageIdDto {
  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class ShareCollabTokenDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class ShareCommentsListDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsString()
  @IsNotEmpty()
  pageId: string;
}

export class ShareGuestCommentDto extends ShareCommentsListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000) // bound unauthenticated input before JSON.parse + sanitize
  content: string;

  // Required for anonymous guests; ignored for signed-in commenters (the
  // controller enforces which applies).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  guestName?: string;

  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  // Inline comment anchor: the selected text (display only) and its Yjs
  // relative positions (shape-validated by yjsSelectionSchema before use).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  selection?: string;

  @IsOptional()
  @IsObject()
  yjsSelection?: { anchor: any; head: any };
}

// Guest actions on an existing comment. `commentId` is resolved to its page
// server-side; the share must cover that page.
export class ShareGuestCommentTargetDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsUUID()
  commentId: string;
}

export class ShareGuestCommentOwnedDto extends ShareGuestCommentTargetDto {
  // Ownership secret returned when the guest created the comment. Optional for
  // a signed-in commenter acting on a comment attributed to their account.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  guestToken?: string;
}

export class ShareGuestCommentUpdateDto extends ShareGuestCommentOwnedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  content: string;
}

export class ShareGuestCommentResolveDto extends ShareGuestCommentTargetDto {
  @IsBoolean()
  resolved: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  guestName?: string;
}

export class ShareTitleDto extends ShareCollabTokenDto {
  @IsString()
  @MaxLength(1000)
  title: string;
}
