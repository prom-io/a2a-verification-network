import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DisputesService } from './disputes.service';
import { DisputeStatus } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';
import { AttachEvidenceDto } from './dto/attach-evidence.dto';
import {
  MAX_INLINE_EVIDENCE_BYTES,
  decodeBase64Strict,
  normalizeHash,
  sha256Hex,
} from './content-hash';

export interface EvidenceVerification {
  evidenceId: string;
  contentHash: string;
  computedHash: string;
  matches: boolean;
}

@Injectable()
export class DisputeEvidenceService {
  private readonly logger = new Logger(DisputeEvidenceService.name);

  constructor(
    @InjectRepository(DisputeEvidence)
    private readonly evidenceRepo: Repository<DisputeEvidence>,
    private readonly disputesService: DisputesService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Attaches evidence to an unresolved dispute. With inline content the hash
   * is computed here and the record is marked as verified; with only a
   * declared hash it is stored as a claim until someone verifies it.
   */
  async attach(disputeId: string, dto: AttachEvidenceDto): Promise<DisputeEvidence> {
    const dispute = await this.disputesService.findOne(disputeId);
    if (dispute.status === DisputeStatus.RESOLVED) {
      // The decision was taken on the evidence present at the time.
      throw new ConflictException(`Dispute ${disputeId} is resolved and accepts no more evidence`);
    }

    let contentHash = dto.contentHash ? normalizeHash(dto.contentHash) : undefined;
    let sizeBytes = dto.sizeBytes ?? null;
    let hashVerified = false;

    if (dto.content !== undefined) {
      const content = this.decode(dto.content);
      const computed = sha256Hex(content);
      if (contentHash && contentHash !== computed) {
        throw new BadRequestException('content does not match the declared contentHash');
      }
      contentHash = computed;
      sizeBytes = content.length;
      hashVerified = true;
    }
    if (!contentHash) {
      throw new BadRequestException('either contentHash or content is required');
    }

    const existing = await this.evidenceRepo.findBy({ disputeId });
    if (existing.some((evidence) => evidence.contentHash === contentHash)) {
      throw new ConflictException(`Evidence ${contentHash} is already attached to dispute ${disputeId}`);
    }
    const limit = Number(this.configService.get('DISPUTE_MAX_EVIDENCE', 20));
    if (existing.length >= limit) {
      throw new UnprocessableEntityException(
        `Dispute ${disputeId} already has the maximum of ${limit} evidence items`,
      );
    }

    const saved = await this.evidenceRepo.save(
      this.evidenceRepo.create({
        disputeId,
        submitter: dto.submitter,
        uri: dto.uri,
        contentHash,
        mimeType: dto.mimeType ?? null,
        sizeBytes,
        description: dto.description ?? null,
        hashVerified,
      }),
    );
    this.logger.log(`Evidence ${saved.id} (${contentHash}) attached to dispute ${disputeId}`);
    return saved;
  }

  async list(disputeId: string): Promise<DisputeEvidence[]> {
    await this.disputesService.findOne(disputeId);
    return this.evidenceRepo.find({ where: { disputeId }, order: { createdAt: 'ASC' } });
  }

  /**
   * Checks content fetched from the evidence URI against the recorded hash.
   * A match is remembered; a mismatch never clears an earlier verification,
   * since it only says that this caller fetched something else.
   */
  async verify(disputeId: string, evidenceId: string, content: string): Promise<EvidenceVerification> {
    const evidence = await this.evidenceRepo.findOneBy({ id: evidenceId, disputeId });
    if (!evidence) {
      throw new NotFoundException(`Evidence ${evidenceId} not found on dispute ${disputeId}`);
    }

    const computedHash = sha256Hex(this.decode(content));
    const matches = computedHash === evidence.contentHash;
    if (matches && !evidence.hashVerified) {
      evidence.hashVerified = true;
      await this.evidenceRepo.save(evidence);
    }
    return { evidenceId, contentHash: evidence.contentHash, computedHash, matches };
  }

  private decode(content: string): Buffer {
    const decoded = decodeBase64Strict(content);
    if (!decoded) throw new BadRequestException('content must be valid base64');
    if (decoded.length > MAX_INLINE_EVIDENCE_BYTES) {
      throw new BadRequestException(
        `content cannot exceed ${MAX_INLINE_EVIDENCE_BYTES} bytes; reference larger evidence by URI and hash`,
      );
    }
    return decoded;
  }
}
