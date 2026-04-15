import {
  IsString,
  IsOptional,
  IsArray,
  IsNotEmpty,
  IsEthereumAddress,
  IsUrl,
  Matches,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterValidatorDto {
  @ApiProperty({ description: 'Validator Ethereum address' })
  @IsNotEmpty({ message: 'address is required' })
  @IsEthereumAddress({ message: 'address must be a valid Ethereum address' })
  address!: string;

  @ApiProperty({ description: 'Hex-encoded public key (with 0x prefix)' })
  @IsString()
  @IsNotEmpty({ message: 'publicKey is required' })
  @Matches(/^0x[0-9a-fA-F]{66,130}$/, {
    message: 'publicKey must be hex-encoded with 0x prefix',
  })
  publicKey!: string;

  @ApiProperty({ description: 'Stake amount in wei as decimal string' })
  @IsString()
  @Matches(/^\d+$/, { message: 'stake must be a positive integer string (wei)' })
  stake!: string;

  @ApiProperty({ description: 'HTTPS endpoint for the validator' })
  @IsUrl(
    { protocols: ['http', 'https'], require_tld: false },
    { message: 'endpoint must be a valid URL' },
  )
  @MaxLength(512, { message: 'endpoint cannot exceed 512 characters' })
  endpoint!: string;

  @ApiProperty({ required: false, type: [String], description: 'Declared capabilities' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32, { message: 'capabilities cannot contain more than 32 entries' })
  @IsString({ each: true })
  @MaxLength(64, { each: true, message: 'each capability must be <= 64 chars' })
  capabilities?: string[];
}
