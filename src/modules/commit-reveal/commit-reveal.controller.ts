import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CommitRevealService } from './commit-reveal.service';
import { CommitVerdictDto } from './dto/commit-verdict.dto';
import { RevealVerdictDto } from './dto/reveal-verdict.dto';

@ApiTags('commit-reveal')
@Controller('jobs/:jobId')
export class CommitRevealController {
  constructor(private readonly commitRevealService: CommitRevealService) {}

  @Post('commitments')
  @ApiOperation({ summary: 'Commit to a verdict without disclosing it' })
  @ApiResponse({ status: 201, description: 'Commitment recorded' })
  @ApiResponse({ status: 403, description: 'Validator is not on the committee or the signature does not match' })
  @ApiResponse({ status: 409, description: 'Commit phase closed or validator already committed' })
  commit(@Param('jobId') jobId: string, @Body() dto: CommitVerdictDto) {
    return this.commitRevealService.commit(jobId, dto);
  }

  @Post('reveals')
  @ApiOperation({ summary: 'Reveal the committed verdict and its salt' })
  @ApiResponse({ status: 201, description: 'Reveal accepted; the round closes with the last reveal' })
  @ApiResponse({ status: 400, description: 'Reveal does not match the commitment' })
  @ApiResponse({ status: 409, description: 'Commit phase still open, reveal phase closed or already revealed' })
  reveal(@Param('jobId') jobId: string, @Body() dto: RevealVerdictDto) {
    return this.commitRevealService.reveal(jobId, dto);
  }

  @Get('commitments')
  @ApiOperation({ summary: 'Phase, deadlines, commitments and tally of the round' })
  status(@Param('jobId') jobId: string) {
    return this.commitRevealService.status(jobId);
  }

  @Post('finalize')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a round after the reveal deadline' })
  @ApiResponse({ status: 200, description: 'Round finalized' })
  @ApiResponse({ status: 409, description: 'Round is still open' })
  finalize(@Param('jobId') jobId: string) {
    return this.commitRevealService.finalize(jobId);
  }
}
