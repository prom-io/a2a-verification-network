import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveDisputeDto {
  @ApiProperty()
  @IsString()
  resolution!: string;
}
