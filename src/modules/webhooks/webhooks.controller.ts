import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';

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
}
