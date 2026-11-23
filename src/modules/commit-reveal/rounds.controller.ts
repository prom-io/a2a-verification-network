import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QuorumTimeoutService } from './quorum-timeout.service';

@ApiTags('commit-reveal')
@Controller('rounds')
export class RoundsController {
  constructor(private readonly quorumTimeoutService: QuorumTimeoutService) {}

  @Post('timeouts/sweep')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Close every round past its reveal deadline; rounds without a quorum are widened or failed',
  })
  @ApiResponse({ status: 200, description: 'Jobs decided, widened, failed, and errors' })
  sweep() {
    return this.quorumTimeoutService.sweep();
  }
}
