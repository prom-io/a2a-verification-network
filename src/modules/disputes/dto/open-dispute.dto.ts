import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OpenDisputeDto {
  @ApiProperty()
  @IsString()
  sessionId!: string;

  @ApiProperty()
  @IsString()
  reason!: string;

  @ApiProperty()
  @IsString()
  initiator!: string;
}
