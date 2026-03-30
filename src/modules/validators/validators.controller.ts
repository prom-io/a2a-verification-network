import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ValidatorsService } from './validators.service';
import { RegisterValidatorDto } from './dto/register-validator.dto';

@ApiTags('validators')
@Controller('validators')
export class ValidatorsController {
  constructor(private readonly validatorsService: ValidatorsService) {}

  @Post()
  @ApiOperation({ summary: 'Register a new validator node' })
  @ApiResponse({ status: 201, description: 'Validator registered successfully' })
  register(@Body() dto: RegisterValidatorDto) {
    return this.validatorsService.register(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all registered validators' })
  findAll() {
    return this.validatorsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get validator by ID' })
  @ApiResponse({ status: 404, description: 'Validator not found' })
  findOne(@Param('id') id: string) {
    return this.validatorsService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deregister a validator (exit)' })
  @ApiResponse({ status: 200, description: 'Validator deregistered' })
  exit(@Param('id') id: string) {
    return this.validatorsService.exit(id);
  }
}
