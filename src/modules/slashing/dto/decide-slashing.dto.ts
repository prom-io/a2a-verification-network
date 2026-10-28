import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideSlashingDto {
  @ApiProperty({ description: 'Operator taking the decision', example: 'did:prom:operator-1' })
  @IsString()
  @IsNotEmpty({ message: 'decidedBy is required' })
  @MaxLength(256)
  decidedBy!: string;

  @ApiProperty({ required: false, description: 'Why the proposal was approved or rejected' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
