import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DisputeOutcome } from '../entities/dispute.entity';

export class ResolveDisputeDto {
  @ApiProperty({ description: 'Outcome recorded for the dispute' })
  @IsString()
  @IsNotEmpty({ message: 'resolution is required' })
  @MaxLength(4000)
  resolution!: string;

  @ApiProperty({
    required: false,
    enum: DisputeOutcome,
    description: 'overturned raises slashing proposals for the validators that signed the verdict',
  })
  @IsOptional()
  @IsEnum(DisputeOutcome, { message: 'outcome must be upheld or overturned' })
  outcome?: DisputeOutcome;
}
