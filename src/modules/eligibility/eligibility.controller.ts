import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { EligibilityService } from './eligibility.service';

@ApiTags('policies')
@Controller('policies')
export class EligibilityController {
  constructor(private readonly eligibilityService: EligibilityService) {}

  @Get(':id/eligible-validators')
  @ApiOperation({
    summary: 'Staked validators with their reputation and whether the policy admits them',
  })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.eligibilityService.report(id);
  }
}
