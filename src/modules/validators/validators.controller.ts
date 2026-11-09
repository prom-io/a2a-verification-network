import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ValidatorsService } from './validators.service';
import { RegisterValidatorDto } from './dto/register-validator.dto';
import { UpdateStakeDto } from './dto/update-stake.dto';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { ValidatorAvailabilityService } from './validator-availability.service';

@ApiTags('validators')
@Controller('validators')
export class ValidatorsController {
  constructor(
    private readonly validatorsService: ValidatorsService,
    private readonly availabilityService: ValidatorAvailabilityService,
  ) {}

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

  // Declared before ':id' so the literal path is not captured as an id.
  @Get('tiers')
  @ApiOperation({ summary: 'Staking tiers with their thresholds and selection weights' })
  tiers() {
    return this.validatorsService.tierTable();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get validator by ID' })
  @ApiResponse({ status: 404, description: 'Validator not found' })
  findOne(@Param('id') id: string) {
    return this.validatorsService.findOne(id);
  }

  @Post('suspensions/sweep')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend active validators whose heartbeat is overdue' })
  @ApiResponse({ status: 200, description: 'Ids of the validators suspended by this sweep' })
  async sweep() {
    return { suspended: await this.availabilityService.suspendStale() };
  }

  @Post(':id/heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signed liveness report; reactivates a suspended validator' })
  @ApiResponse({ status: 200, description: 'Heartbeat recorded' })
  @ApiResponse({ status: 403, description: 'Not signed by the validator address' })
  @ApiResponse({ status: 409, description: 'Validator exited, or heartbeat not newer than the last one' })
  heartbeat(@Param('id') id: string, @Body() dto: HeartbeatDto) {
    return this.availabilityService.heartbeat(id, dto);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Last heartbeat, next deadline and suspension state' })
  @ApiResponse({ status: 404, description: 'Validator not found' })
  availability(@Param('id') id: string) {
    return this.availabilityService.availability(id);
  }

  @Patch(':id/stake')
  @ApiOperation({ summary: 'Set the validator stake and recompute its tier' })
  @ApiResponse({ status: 200, description: 'Stake updated' })
  @ApiResponse({ status: 404, description: 'Validator not found' })
  updateStake(@Param('id') id: string, @Body() dto: UpdateStakeDto) {
    return this.validatorsService.updateStake(id, dto.stake);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deregister a validator (exit)' })
  @ApiResponse({ status: 200, description: 'Validator deregistered' })
  exit(@Param('id') id: string) {
    return this.validatorsService.exit(id);
  }
}
