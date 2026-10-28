import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DecideSlashingDto } from './dto/decide-slashing.dto';
import { SlashingProposalStatus } from './entities/slashing-proposal.entity';
import { SlashingService } from './slashing.service';

@ApiTags('slashing')
@Controller('slashing/proposals')
export class SlashingController {
  constructor(private readonly slashingService: SlashingService) {}

  @Get()
  @ApiOperation({ summary: 'List slashing proposals' })
  @ApiQuery({ name: 'status', required: false, enum: SlashingProposalStatus })
  @ApiQuery({ name: 'validatorId', required: false })
  @ApiQuery({ name: 'disputeId', required: false })
  findAll(
    @Query('status', new ParseEnumPipe(SlashingProposalStatus, { optional: true }))
    status?: SlashingProposalStatus,
    @Query('validatorId') validatorId?: string,
    @Query('disputeId') disputeId?: string,
  ) {
    return this.slashingService.findAll({ status, validatorId, disputeId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a slashing proposal' })
  @ApiResponse({ status: 404, description: 'Proposal not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.slashingService.findOne(id);
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve a proposal and reduce the validator stake' })
  @ApiResponse({ status: 200, description: 'Proposal approved, stake reduced' })
  @ApiResponse({ status: 409, description: 'Proposal already decided' })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideSlashingDto) {
    return this.slashingService.approve(id, dto);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject a proposal and leave the stake untouched' })
  @ApiResponse({ status: 200, description: 'Proposal rejected' })
  @ApiResponse({ status: 409, description: 'Proposal already decided' })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideSlashingDto) {
    return this.slashingService.reject(id, dto);
  }
}
