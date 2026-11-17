import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { DeadLetterQueryDto } from './dto/dead-letter-query.dto';
import { ReplayDeadLettersDto } from './dto/replay-dead-letters.dto';

@ApiTags('webhooks')
@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get('jobs/:jobId/webhooks')
  @ApiOperation({ summary: 'Webhook deliveries of a job with their attempt history' })
  listForJob(@Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.webhooksService.listForJob(jobId);
  }

  @Post('webhooks/deliveries/:id/redeliver')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send an undelivered webhook again now' })
  @ApiResponse({ status: 200, description: 'Delivery after the attempt' })
  @ApiResponse({ status: 409, description: 'Already delivered' })
  redeliver(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.redeliver(id);
  }

  @Get('webhooks/dead-letters')
  @ApiOperation({ summary: 'Deliveries that are not retried any more, newest first' })
  deadLetters(@Query() query: DeadLetterQueryDto) {
    return this.webhooksService.listDeadLetters(query.limit ?? 50, query.jobId);
  }

  @Post('webhooks/dead-letters/replay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Put dead-lettered deliveries back on the retry schedule' })
  @ApiResponse({ status: 200, description: 'The deliveries that were requeued' })
  async replay(@Body() dto: ReplayDeadLettersDto) {
    const replayed = await this.webhooksService.replayDeadLetters({ ids: dto.ids, limit: dto.limit });
    return { replayed: replayed.length, deliveries: replayed };
  }
}
