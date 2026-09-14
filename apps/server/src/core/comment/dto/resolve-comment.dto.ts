import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

// MXD: body for POST /comments/resolve (fork-owned resolution).
export class ResolveCommentDto {
  @IsUUID()
  commentId: string;

  // Accepted for client compatibility; the comment's own pageId is authoritative.
  @IsOptional()
  @IsString()
  pageId?: string;

  @IsBoolean()
  resolved: boolean;
}
