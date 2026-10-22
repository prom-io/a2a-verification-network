import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateStakeDto {
  @ApiProperty({ description: 'New total stake in wei as a decimal string' })
  @IsString()
  @Matches(/^\d+$/, { message: 'stake must be a non-negative integer string (wei)' })
  @MaxLength(78, { message: 'stake does not fit into uint256' })
  stake!: string;
}
