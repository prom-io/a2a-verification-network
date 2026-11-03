import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { AppealVoteChoice } from '../appeal-quorum';

export class OpenAppealDto {
  @ApiProperty({ description: 'DID of the party appealing the resolution', example: 'did:prom:agent-b' })
  @IsString()
  @Matches(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/, {
    message: 'appellant must be a DID (did:<method>:<id>)',
  })
  @MaxLength(256)
  appellant!: string;

  @ApiProperty({ description: 'Why the resolution should be reviewed' })
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(4000)
  reason!: string;
}

export class CastAppealVoteDto {
  @ApiProperty({ description: 'Panel member casting the vote' })
  @IsUUID('4', { message: 'validatorId must be a valid UUID v4' })
  validatorId!: string;

  @ApiProperty({ enum: AppealVoteChoice })
  @IsEnum(AppealVoteChoice, { message: 'vote must be uphold or overturn' })
  vote!: AppealVoteChoice;

  @ApiProperty({
    description: 'EIP-191 signature of "prom-appeal:<appealId>:<vote>" by the validator address',
  })
  @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte hex signature' })
  signature!: string;
}
