import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ReputationService } from './reputation.service';

@ApiTags('reputation')
@Controller('reputation')
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @Get(':entityId')
  findByEntityId(@Param('entityId') entityId: string) {
    return this.reputationService.findByEntityId(entityId);
  }
}
