import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class SubmitJobDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  sessionId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  requestHash!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resultHash?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  policyId!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  artifactsRef?: string;
}
