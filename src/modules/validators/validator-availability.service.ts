import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { ethers } from 'ethers';
import { Repository } from 'typeorm';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { Validator } from './entities/validator.entity';

export const SUSPENSION_MISSED_HEARTBEAT = 'missed_heartbeat';

/** Message a validator signs (EIP-191) to prove it is alive at `timestamp`. */
export function heartbeatMessage(validatorId: string, timestamp: number): string {
  return `prom-heartbeat:${validatorId}:${timestamp}`;
}

export interface AvailabilityView {
  validatorId: string;
  isActive: boolean;
  lastHeartbeatAt: Date | null;
  /** A heartbeat is expected before this time, or the validator is suspended. */
  heartbeatDueBy: Date | null;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  exitedAt: Date | null;
}

export interface HeartbeatResult extends AvailabilityView {
  /** True when this heartbeat brought a suspended validator back. */
  reactivated: boolean;
}

/**
 * Liveness tracking for validators.
 *
 * A validator that is assigned to a committee but is not running costs every
 * job it is drawn for a missing vote. Validators therefore report in with a
 * signed heartbeat; one that stays silent for longer than the timeout is
 * suspended, which takes it out of committee selection until it reports again.
 */
@Injectable()
export class ValidatorAvailabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValidatorAvailabilityService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(Validator)
    private readonly validatorRepo: Repository<Validator>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const sweepMs = Number(this.configService.get('HEARTBEAT_SWEEP_MS', 0));
    if (!(sweepMs > 0)) return;

    this.timer = setInterval(() => {
      this.suspendStale().catch((error: Error) =>
        this.logger.error(`Heartbeat sweep failed: ${error.message}`),
      );
    }, sweepMs);
    this.timer.unref();
    this.logger.log(
      `Heartbeat sweep started: every ${sweepMs}ms, timeout ${this.timeoutMs() / 1000}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async heartbeat(id: string, dto: HeartbeatDto, now = new Date()): Promise<HeartbeatResult> {
    const validator = await this.find(id);
    if (validator.exitedAt) {
      throw new ConflictException(`Validator ${id} has exited and cannot report availability`);
    }

    let signer: string;
    try {
      signer = ethers.verifyMessage(heartbeatMessage(id, dto.timestamp), dto.signature);
    } catch {
      throw new BadRequestException('signature is not a valid heartbeat signature');
    }
    if (signer.toLowerCase() !== validator.address.toLowerCase()) {
      throw new ForbiddenException('Heartbeat is not signed by the validator address');
    }

    // A captured heartbeat must not keep a dead validator alive: it has to be
    // recent, and newer than the last one accepted.
    const skewMs = Number(this.configService.get('HEARTBEAT_MAX_SKEW_SECONDS', 120)) * 1000;
    if (Math.abs(now.getTime() - dto.timestamp) > skewMs) {
      throw new BadRequestException('heartbeat timestamp is too far from the current time');
    }
    if (validator.lastHeartbeatAt && dto.timestamp <= new Date(validator.lastHeartbeatAt).getTime()) {
      throw new ConflictException('heartbeat is not newer than the last one recorded');
    }

    const reactivated = !validator.isActive && !!validator.suspendedAt;
    validator.lastHeartbeatAt = new Date(dto.timestamp);
    if (reactivated) {
      validator.isActive = true;
      validator.suspendedAt = null;
      validator.suspensionReason = null;
      this.logger.log(`Validator ${id} reactivated by heartbeat`);
    }
    const saved = await this.validatorRepo.save(validator);
    return { ...this.view(saved), reactivated };
  }

  async availability(id: string): Promise<AvailabilityView> {
    return this.view(await this.find(id));
  }

  /**
   * Suspends every active validator that has not been heard from within the
   * timeout. A validator that has never sent a heartbeat is measured from its
   * registration, so a new node gets one full timeout to come up.
   */
  async suspendStale(now = new Date()): Promise<string[]> {
    const cutoff = now.getTime() - this.timeoutMs();
    const active = await this.validatorRepo.findBy({ isActive: true });
    const stale = active.filter(
      (validator) =>
        new Date(validator.lastHeartbeatAt ?? validator.registeredAt).getTime() < cutoff,
    );

    for (const validator of stale) {
      validator.isActive = false;
      validator.suspendedAt = now;
      validator.suspensionReason = SUSPENSION_MISSED_HEARTBEAT;
      await this.validatorRepo.save(validator);
    }
    if (stale.length > 0) {
      this.logger.warn(
        `Suspended ${stale.length} validator(s) for missed heartbeats: ${stale.map((v) => v.id).join(', ')}`,
      );
    }
    return stale.map((validator) => validator.id);
  }

  private timeoutMs(): number {
    return Number(this.configService.get('HEARTBEAT_TIMEOUT_SECONDS', 180)) * 1000;
  }

  private async find(id: string): Promise<Validator> {
    const validator = await this.validatorRepo.findOneBy({ id });
    if (!validator) throw new NotFoundException(`Validator ${id} not found`);
    return validator;
  }

  private view(validator: Validator): AvailabilityView {
    const lastSeen = validator.lastHeartbeatAt ?? validator.registeredAt;
    return {
      validatorId: validator.id,
      isActive: validator.isActive,
      lastHeartbeatAt: validator.lastHeartbeatAt ?? null,
      heartbeatDueBy:
        validator.isActive && lastSeen
          ? new Date(new Date(lastSeen).getTime() + this.timeoutMs())
          : null,
      suspendedAt: validator.suspendedAt ?? null,
      suspensionReason: validator.suspensionReason ?? null,
      exitedAt: validator.exitedAt ?? null,
    };
  }
}
