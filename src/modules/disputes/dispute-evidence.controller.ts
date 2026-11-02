import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { AttachEvidenceDto } from './dto/attach-evidence.dto';
import { VerifyEvidenceDto } from './dto/verify-evidence.dto';

@ApiTags('disputes')
@Controller('disputes/:disputeId/evidence')
export class DisputeEvidenceController {
  constructor(private readonly evidenceService: DisputeEvidenceService) {}

  @Post()
  @ApiOperation({ summary: 'Attach evidence to an unresolved dispute' })
  @ApiResponse({ status: 201, description: 'Evidence attached' })
  @ApiResponse({ status: 400, description: 'Missing hash, bad base64 or content not matching the hash' })
  @ApiResponse({ status: 409, description: 'Dispute resolved or evidence already attached' })
  attach(
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: AttachEvidenceDto,
  ) {
    return this.evidenceService.attach(disputeId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the evidence attached to a dispute' })
  list(@Param('disputeId', ParseUUIDPipe) disputeId: string) {
    return this.evidenceService.list(disputeId);
  }

  @Post(':evidenceId/verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check fetched content against the recorded hash' })
  @ApiResponse({ status: 200, description: 'Comparison result; a match marks the evidence as verified' })
  verify(
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Body() dto: VerifyEvidenceDto,
  ) {
    return this.evidenceService.verify(disputeId, evidenceId, dto.content);
  }
}
