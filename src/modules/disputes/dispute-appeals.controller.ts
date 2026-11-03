import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DisputeAppealsService } from './dispute-appeals.service';
import { CastAppealVoteDto, OpenAppealDto } from './dto/appeal.dto';

@ApiTags('disputes')
@Controller('disputes/:disputeId/appeal')
export class DisputeAppealsController {
  constructor(private readonly appealsService: DisputeAppealsService) {}

  @Post()
  @ApiOperation({ summary: 'Appeal a resolved dispute before an expanded validator panel' })
  @ApiResponse({ status: 201, description: 'Appeal opened and panel drawn' })
  @ApiResponse({ status: 409, description: 'Not resolved, already appealed or outside the appeal window' })
  @ApiResponse({ status: 422, description: 'Not enough independent staked validators for a panel' })
  open(@Param('disputeId', ParseUUIDPipe) disputeId: string, @Body() dto: OpenAppealDto) {
    return this.appealsService.open(disputeId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Appeal of a dispute with its panel, votes and tally' })
  @ApiResponse({ status: 404, description: 'Dispute has no appeal' })
  find(@Param('disputeId', ParseUUIDPipe) disputeId: string) {
    return this.appealsService.findByDispute(disputeId);
  }

  @Post('votes')
  @ApiOperation({ summary: 'Cast a signed panel vote' })
  @ApiResponse({ status: 201, description: 'Vote recorded; the appeal closes once the result is certain' })
  @ApiResponse({ status: 403, description: 'Not a panel member or signature mismatch' })
  @ApiResponse({ status: 409, description: 'Already voted, voting closed or appeal decided' })
  vote(@Param('disputeId', ParseUUIDPipe) disputeId: string, @Body() dto: CastAppealVoteDto) {
    return this.appealsService.vote(disputeId, dto);
  }

  @Post('close')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close an appeal after its voting deadline' })
  @ApiResponse({ status: 409, description: 'Voting is still open' })
  close(@Param('disputeId', ParseUUIDPipe) disputeId: string) {
    return this.appealsService.close(disputeId);
  }
}
