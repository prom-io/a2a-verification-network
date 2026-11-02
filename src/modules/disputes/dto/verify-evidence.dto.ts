import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEvidenceDto {
  @ApiProperty({ description: 'Content fetched from the evidence URI, as base64 (up to 64 KiB)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(87384, { message: 'content cannot exceed 64 KiB' })
  content!: string;
}
