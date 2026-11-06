import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SubmitJobDto } from './dto/submit-job.dto';
import { DrainQueueDto } from './dto/drain-queue.dto';
import { QueueQueryDto } from './dto/queue-query.dto';
import { JobQueueService } from './job-queue.service';
import { JobStatus } from './entities/verification-job.entity';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly coordinatorService: CoordinatorService,
    private readonly jobQueueService: JobQueueService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a verification job; processed at once unless deferred' })
  async submit(@Body() dto: SubmitJobDto) {
    const job = await this.jobsService.submit(dto);
    if (dto.deferred) {
      // Left pending: the queue hands it to the coordinator in priority order.
      return { job, verification: null, queued: true };
    }
    const result = await this.coordinatorService.processJob(job.id);
    return { job, verification: result, queued: false };
  }

  // The queue routes are declared before ':id' so 'queue' is not read as an id.
  @Get('queue')
  @ApiOperation({ summary: 'Pending jobs in processing order (fee-weighted, with aging)' })
  queue(@Query() query: QueueQueryDto) {
    return this.jobQueueService.list(query.limit ?? 50);
  }

  @Post('queue/drain')
  @HttpCode(200)
  @ApiOperation({ summary: 'Process jobs from the head of the queue' })
  drain(@Body() dto: DrainQueueDto) {
    return this.jobQueueService.drain(dto.limit ?? 10);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get job by ID' })
  findOne(@Param('id') id: string) {
    return this.jobsService.findOne(id);
  }

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: JobStatus })
  @ApiOperation({ summary: 'List jobs' })
  findAll(@Query('status') status?: JobStatus) {
    return this.jobsService.findAll(status);
  }
}
