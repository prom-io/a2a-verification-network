import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ValidatorsService } from './validators.service';
import { RegisterValidatorDto } from './dto/register-validator.dto';

@ApiTags('validators')
@Controller('validators')
export class ValidatorsController {
  constructor(private readonly validatorsService: ValidatorsService) {}

  @Post()
  register(@Body() dto: RegisterValidatorDto) {
    return this.validatorsService.register(dto);
  }

  @Get()
  findAll() {
    return this.validatorsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.validatorsService.findOne(id);
  }

  @Delete(':id')
  exit(@Param('id') id: string) {
    return this.validatorsService.exit(id);
  }
}
