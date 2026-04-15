import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';

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
}
