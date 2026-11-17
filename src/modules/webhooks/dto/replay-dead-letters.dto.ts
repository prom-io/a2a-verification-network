import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ReplayDeadLettersDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Deliveries to replay; without it the oldest dead letters are replayed',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids?: string[];

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
