import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CommenterSignInRequestDto {
  @IsString()
  @IsNotEmpty()
  shareId: string;

  @IsString()
  @IsNotEmpty()
  pageId: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsString()
  @MaxLength(400)
  returnPath: string;
}

export class GuestCommentOwnershipDto {
  @IsUUID()
  commentId: string;

  @IsString()
  @MaxLength(200)
  guestToken: string;
}

export class CommenterSignInVerifyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => GuestCommentOwnershipDto)
  guestComments?: GuestCommentOwnershipDto[];
}
