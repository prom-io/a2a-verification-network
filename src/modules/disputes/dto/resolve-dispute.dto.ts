import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveDisputeDto {
  @ApiProperty({ description: 'Outcome recorded for the dispute' })
  @IsString()
  @IsNotEmpty({ message: 'resolution is required' })
  @MaxLength(4000)
  resolution!: string;
}
