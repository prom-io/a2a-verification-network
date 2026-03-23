import { IsString, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterValidatorDto {
  @ApiProperty()
  @IsString()
  address!: string;

  @ApiProperty()
  @IsString()
  publicKey!: string;

  @ApiProperty()
  @IsString()
  stake!: string;

  @ApiProperty()
  @IsString()
  endpoint!: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
