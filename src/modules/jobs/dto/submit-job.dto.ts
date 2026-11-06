import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { VerdictMode } from '../entities/verification-job.entity';

export class SubmitJobDto {
  @ApiProperty({ description: 'Escrow session UUID' })
  @IsUUID('4', { message: 'sessionId must be a valid UUID v4' })
  sessionId!: string;

  @ApiProperty({ description: '0x-prefixed 32-byte request hash' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'requestHash must be a 0x-prefixed 32-byte hex hash',
  })
  requestHash!: string;

  @ApiProperty({ required: false, description: '0x-prefixed 32-byte result hash' })
  @IsOptional()
  @Matches(/^0x[0-9a-fA-F]{64}$/, {
    message: 'resultHash must be a 0x-prefixed 32-byte hex hash',
  })
  resultHash?: string;

  @ApiProperty({ description: 'Policy UUID to evaluate against' })
  @IsUUID('4', { message: 'policyId must be a valid UUID v4' })
  policyId!: string;

  @ApiProperty({ required: false, description: 'Reference to external artifacts (e.g. IPFS URI)' })
  @IsOptional()
  @IsString()
  @MaxLength(512, { message: 'artifactsRef cannot exceed 512 characters' })
  artifactsRef?: string;

  @ApiProperty({
    required: false,
    enum: VerdictMode,
    default: VerdictMode.INSTANT,
    description: 'commit_reveal makes the committee vote in two phases instead of an instant verdict',
  })
  @IsOptional()
  @IsEnum(VerdictMode, { message: 'verdictMode must be instant or commit_reveal' })
  verdictMode?: VerdictMode;

  @ApiProperty({
    required: false,
    description: 'Fee offered for the job in wei; a higher fee is processed earlier',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,78}$/, { message: 'fee must be a non-negative integer string (wei)' })
  fee?: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Queue the job instead of processing it in the request',
  })
  @IsOptional()
  @IsBoolean()
  deferred?: boolean;
}
