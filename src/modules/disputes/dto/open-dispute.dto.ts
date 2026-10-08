import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OpenDisputeDto {
  @ApiProperty({ description: 'Session the disputed verdict belongs to' })
  @IsString()
  @IsNotEmpty({ message: 'sessionId is required' })
  @MaxLength(128)
  sessionId!: string;

  @ApiProperty({ description: 'Why the verdict is contested' })
  @IsString()
  @IsNotEmpty({ message: 'reason is required' })
  @MaxLength(4000)
  reason!: string;

  @ApiProperty({ description: 'DID of the party opening the dispute', example: 'did:prom:agent-a' })
  @IsString()
  @Matches(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/, {
    message: 'initiator must be a DID (did:<method>:<id>)',
  })
  @MaxLength(256)
  initiator!: string;
}
