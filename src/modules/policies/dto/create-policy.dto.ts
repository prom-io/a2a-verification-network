import {
  IsString,
  IsEnum,
  IsObject,
  IsInt,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VerificationClass } from '../entities/verification-policy.entity';

export class CreatePolicyDto {
  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ enum: VerificationClass })
  @IsEnum(VerificationClass)
  verificationClass!: VerificationClass;

  @ApiProperty()
  @IsObject()
  selectionRule!: Record<string, unknown>;

  @ApiProperty()
  @IsString()
  verificationMethod!: string;

  @ApiProperty()
  @IsInt()
  quorumThreshold!: number;

  @ApiProperty()
  @IsString()
  price!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  disputeEscalation?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  evidenceRequirements?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metadataUri?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metadataHash?: string;
}
