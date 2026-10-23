import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, Matches } from 'class-validator';

export class CommitVerdictDto {
  @ApiProperty({ description: 'Validator submitting the commitment' })
  @IsUUID('4', { message: 'validatorId must be a valid UUID v4' })
  validatorId!: string;

  @ApiProperty({
    description: 'keccak256(abi.encodePacked(jobId, validatorId, outcome, salt)) as 0x-prefixed hex',
  })
  @Matches(/^0x[0-9a-fA-F]{64}$/, { message: 'commitHash must be a 0x-prefixed 32-byte hex hash' })
  commitHash!: string;

  @ApiProperty({
    description: 'EIP-191 signature of the commit hash bytes by the validator address',
  })
  @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte hex signature' })
  signature!: string;
}
