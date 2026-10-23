import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerificationJob, JobStatus, VerdictMode } from './entities/verification-job.entity';
import { SubmitJobDto } from './dto/submit-job.dto';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(VerificationJob)
    private readonly jobRepo: Repository<VerificationJob>,
    private readonly configService: ConfigService,
  ) {}

  async submit(dto: SubmitJobDto): Promise<VerificationJob> {
    const job = this.jobRepo.create({
      sessionId: dto.sessionId,
      requestHash: dto.requestHash,
      resultHash: dto.resultHash ?? '',
      policyId: dto.policyId,
      artifactsRef: dto.artifactsRef ?? null,
      verdictMode: dto.verdictMode ?? VerdictMode.INSTANT,
      status: JobStatus.PENDING,
    });
    const saved = await this.jobRepo.save(job);
    this.logger.log(`Job submitted: ${saved.id} for session ${dto.sessionId}`);
    return saved;
  }

  async findOne(id: string): Promise<VerificationJob> {
    const job = await this.jobRepo.findOneBy({ id });
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  async findAll(status?: JobStatus): Promise<VerificationJob[]> {
    if (status) return this.jobRepo.findBy({ status });
    return this.jobRepo.find();
  }

  async updateStatus(id: string, status: JobStatus): Promise<VerificationJob> {
    const job = await this.findOne(id);
    job.status = status;
    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      job.completedAt = new Date();
    }
    return this.jobRepo.save(job);
  }

  async assignValidators(id: string, validators: string[]): Promise<VerificationJob> {
    const job = await this.findOne(id);
    job.assignedValidators = validators;
    job.status = JobStatus.ASSIGNED;
    if (job.verdictMode === VerdictMode.COMMIT_REVEAL) {
      // The clock starts when the committee is known, not when the job was
      // submitted: a job that waited for assignment keeps its full window.
      const commitMs = Number(this.configService.get('COMMIT_PHASE_SECONDS', 300)) * 1000;
      const revealMs = Number(this.configService.get('REVEAL_PHASE_SECONDS', 300)) * 1000;
      const now = Date.now();
      job.commitDeadline = new Date(now + commitMs);
      job.revealDeadline = new Date(now + commitMs + revealMs);
    }
    return this.jobRepo.save(job);
  }

  async findBySessionId(sessionId: string): Promise<VerificationJob | null> {
    return this.jobRepo.findOneBy({ sessionId });
  }
}
