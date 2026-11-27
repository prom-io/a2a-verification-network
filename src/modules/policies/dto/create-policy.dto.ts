import {
  IsString,
  IsEnum,
  IsObject,
  IsInt,
  IsOptional,
  IsNumber,
  Max,
  Min,
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

  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: 1,
    default: 0,
    description: 'Lowest effective reputation a validator needs to be drawn for jobs under this policy',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  minReputationScore?: number;
}
