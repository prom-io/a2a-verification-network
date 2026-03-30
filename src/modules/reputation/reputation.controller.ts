import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @Get(':entityId')
  @ApiOperation({ summary: 'Get reputation score for a validator or agent' })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  findByEntityId(@Param('entityId') entityId: string) {
    return this.reputationService.findByEntityId(entityId);
  }
}
