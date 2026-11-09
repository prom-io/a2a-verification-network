import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Min } from 'class-validator';

export class HeartbeatDto {
  @ApiProperty({ description: 'Time the heartbeat was produced, in milliseconds since the epoch' })
  @IsInt({ message: 'timestamp must be an integer number of milliseconds' })
  @Min(0)
  timestamp!: number;

  @ApiProperty({
    description: 'EIP-191 signature of "prom-heartbeat:<validatorId>:<timestamp>" by the validator address',
  })
  @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte hex signature' })
  signature!: string;
}
