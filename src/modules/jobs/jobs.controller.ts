import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { SubmitJobDto } from './dto/submit-job.dto';
import { JobStatus } from './entities/verification-job.entity';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly coordinatorService: CoordinatorService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Submit a verification job and process it' })
  async submit(@Body() dto: SubmitJobDto) {
    const job = await this.jobsService.submit(dto);
    const result = await this.coordinatorService.processJob(job.id);
    return { job, verification: result };
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
