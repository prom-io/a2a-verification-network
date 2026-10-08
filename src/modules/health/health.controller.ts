import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@ApiTags('health')
// The throttlers are named (see throttler.config.ts) and a bare SkipThrottle()
// only lifts the unnamed default, which left probes subject to both limits.
@SkipThrottle({ short: true, long: true })
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Health check with component status' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is degraded' })
  check() {
    return this.healthService.check();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe for orchestrators' })
  @ApiResponse({ status: 200, description: 'Service is ready to accept traffic' })
  readiness() {
    return this.healthService.readiness();
  }
}
