import { Injectable } from '@nestjs/common';
import { Gauge } from 'prom-client';
import { MetricsService } from './metrics.service';

@Injectable()
export class DomainGaugesService {
  private readonly validators: Gauge<string>;
  private readonly jobs: Gauge<string>;
  private readonly disputes: Gauge<string>;

  constructor(metrics: MetricsService) {
    const registers = [metrics.registry];
    this.validators = new Gauge({ name: 'validators', help: 'Validators by status', labelNames: ['status'], registers });
    this.jobs = new Gauge({ name: 'jobs', help: 'Jobs by status', labelNames: ['status'], registers });
    this.disputes = new Gauge({ name: 'disputes', help: 'Disputes by status', labelNames: ['status'], registers });
  }

  setValidators(status: string, n: number): void { this.validators.set({ status }, n); }
  setJobs(status: string, n: number): void { this.jobs.set({ status }, n); }
  setDisputes(status: string, n: number): void { this.disputes.set({ status }, n); }
}
