import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// 64 KiB of content is 87384 base64 characters.
const MAX_INLINE_BASE64_LENGTH = 87384;

export class AttachEvidenceDto {
  @ApiProperty({ description: 'DID of the party submitting the evidence', example: 'did:prom:agent-a' })
  @IsString()
  @Matches(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/, {
    message: 'submitter must be a DID (did:<method>:<id>)',
  })
  @MaxLength(256)
  submitter!: string;

  @ApiProperty({ description: 'Where the evidence can be fetched (https, ipfs or ar URI)' })
  @IsString()
  @Matches(/^(https?|ipfs|ar):\/\/\S+$/, { message: 'uri must be an http(s), ipfs or ar URI' })
  @MaxLength(1024)
  uri!: string;

  @ApiProperty({
    required: false,
    description: 'SHA-256 of the content as 0x-prefixed hex. Required unless content is sent inline.',
  })
  @ValidateIf((dto: AttachEvidenceDto) => dto.content === undefined || dto.contentHash !== undefined)
  @Matches(/^0x[0-9a-fA-F]{64}$/, { message: 'contentHash must be a 0x-prefixed SHA-256 hex digest' })
  contentHash?: string;

  @ApiProperty({
    required: false,
    description: 'Content as base64 (up to 64 KiB). The service hashes it; it is not stored.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_INLINE_BASE64_LENGTH, { message: 'inline content cannot exceed 64 KiB' })
  content?: string;

  @ApiProperty({ required: false, example: 'application/pdf' })
  @IsOptional()
  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/, { message: 'mimeType must look like type/subtype' })
  @MaxLength(128)
  mimeType?: string;

  @ApiProperty({ required: false, description: 'Size of the content in bytes' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
