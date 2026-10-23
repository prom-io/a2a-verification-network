import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID, Matches } from 'class-validator';
import { VerdictOutcome } from '../../verdicts/entities/verdict.entity';

export class RevealVerdictDto {
  @ApiProperty({ description: 'Validator revealing its vote' })
  @IsUUID('4', { message: 'validatorId must be a valid UUID v4' })
  validatorId!: string;

  @ApiProperty({ enum: VerdictOutcome })
  @IsEnum(VerdictOutcome, { message: 'outcome must be accept, partial or reject' })
  outcome!: VerdictOutcome;

  @ApiProperty({ description: 'The 32-byte salt used in the commitment, 0x-prefixed hex' })
  @Matches(/^0x[0-9a-fA-F]{64}$/, { message: 'salt must be a 0x-prefixed 32-byte hex value' })
  salt!: string;
}
