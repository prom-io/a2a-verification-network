import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { MAX_INLINE_EVIDENCE_BYTES, decodeBase64Strict, normalizeHash, sha256Hex } from './content-hash';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { DisputesService } from './disputes.service';
import { DisputeStatus } from './entities/dispute.entity';
import { DisputeEvidence } from './entities/dispute-evidence.entity';

const b64 = (text: string) => Buffer.from(text).toString('base64');
const hashOf = (text: string) => sha256Hex(Buffer.from(text));

function build(status = DisputeStatus.OPEN, config: Record<string, unknown> = {}) {
  const rows: DisputeEvidence[] = [];
  const matches = (row: DisputeEvidence, where: Partial<DisputeEvidence>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof DisputeEvidence] === value);
  const repo = {
    create: jest.fn((data: Partial<DisputeEvidence>) => ({ ...data }) as DisputeEvidence),
    save: jest.fn(async (evidence: DisputeEvidence) => {
      if (!evidence.id) {
        evidence.id = `evidence-${rows.length + 1}`;
        rows.push(evidence);
      }
      return evidence;
    }),
    find: jest.fn(async ({ where }: { where: Partial<DisputeEvidence> }) =>
      rows.filter((row) => matches(row, where)),
    ),
    findBy: jest.fn(async (where: Partial<DisputeEvidence>) => rows.filter((row) => matches(row, where))),
    findOneBy: jest.fn(async (where: Partial<DisputeEvidence>) => rows.find((row) => matches(row, where)) ?? null),
  };
  const disputes = {
    findOne: jest.fn(async (id: string) => {
      if (id === 'missing') throw new NotFoundException(`Dispute ${id} not found`);
      return { id, status };
    }),
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
  };
  const service = new DisputeEvidenceService(
    repo as unknown as Repository<DisputeEvidence>,
    disputes as unknown as DisputesService,
    configService as unknown as ConfigService,
  );
  return { service, rows };
}

const base = { submitter: 'did:prom:agent-a', uri: 'ipfs://bafy-evidence' };

describe('content hashing', () => {
  it('produces the standard SHA-256 digest', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('normalises hashes to lowercase', () => {
    expect(normalizeHash(' 0xABCDEF ')).toBe('0xabcdef');
  });

  it('decodes only canonical base64', () => {
    expect(decodeBase64Strict(b64('hello'))?.toString()).toBe('hello');
    expect(decodeBase64Strict('')).toBeNull();
    expect(decodeBase64Strict('aGVsbG8')).toBeNull(); // padding stripped
    expect(decodeBase64Strict('aGV sbG8=')).toBeNull(); // whitespace
    expect(decodeBase64Strict('aGVsbG8*')).toBeNull(); // foreign character
  });
});

describe('DisputeEvidenceService.attach', () => {
  it('computes the hash of inline content and marks the evidence verified', async () => {
    const { service } = build();

    const evidence = await service.attach('dispute-1', {
      ...base,
      content: b64('delivery log'),
      mimeType: 'text/plain',
    });

    expect(evidence).toMatchObject({
      disputeId: 'dispute-1',
      contentHash: hashOf('delivery log'),
      sizeBytes: 12,
      hashVerified: true,
      mimeType: 'text/plain',
      description: null,
    });
    expect(evidence).not.toHaveProperty('content');
  });

  it('stores a declared hash as an unverified claim', async () => {
    const { service } = build();

    const evidence = await service.attach('dispute-1', {
      ...base,
      contentHash: hashOf('remote file').toUpperCase().replace('0X', '0x'),
      sizeBytes: 4096,
    });

    expect(evidence).toMatchObject({
      contentHash: hashOf('remote file'),
      sizeBytes: 4096,
      hashVerified: false,
    });
  });

  it('accepts inline content together with a matching declared hash', async () => {
    const { service } = build();

    const evidence = await service.attach('dispute-1', {
      ...base,
      content: b64('same'),
      contentHash: hashOf('same'),
    });

    expect(evidence.hashVerified).toBe(true);
  });

  it('rejects inline content that does not match the declared hash', async () => {
    const { service, rows } = build();

    await expect(
      service.attach('dispute-1', { ...base, content: b64('actual'), contentHash: hashOf('claimed') }),
    ).rejects.toThrow('content does not match the declared contentHash');
    expect(rows).toHaveLength(0);
  });

  it('requires a hash or content', async () => {
    const { service } = build();

    await expect(service.attach('dispute-1', { ...base })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed base64 and oversized content', async () => {
    const { service } = build();
    const tooBig = Buffer.alloc(MAX_INLINE_EVIDENCE_BYTES + 1).toString('base64');

    await expect(service.attach('dispute-1', { ...base, content: 'not base64!!' })).rejects.toThrow(
      'content must be valid base64',
    );
    await expect(service.attach('dispute-1', { ...base, content: tooBig })).rejects.toThrow(
      'content cannot exceed',
    );
  });

  it('rejects a duplicate hash on the same dispute only', async () => {
    const { service } = build();
    await service.attach('dispute-1', { ...base, contentHash: hashOf('doc') });

    await expect(
      service.attach('dispute-1', { ...base, content: b64('doc') }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.attach('dispute-2', { ...base, contentHash: hashOf('doc') }),
    ).resolves.toMatchObject({ disputeId: 'dispute-2' });
  });

  it('enforces the per-dispute evidence limit', async () => {
    const { service } = build(DisputeStatus.OPEN, { DISPUTE_MAX_EVIDENCE: 2 });
    await service.attach('dispute-1', { ...base, contentHash: hashOf('1') });
    await service.attach('dispute-1', { ...base, contentHash: hashOf('2') });

    await expect(
      service.attach('dispute-1', { ...base, contentHash: hashOf('3') }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('refuses evidence for a resolved dispute', async () => {
    const { service } = build(DisputeStatus.RESOLVED);

    await expect(
      service.attach('dispute-1', { ...base, contentHash: hashOf('late') }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('still accepts evidence for an escalated dispute', async () => {
    const { service } = build(DisputeStatus.ESCALATED);

    await expect(
      service.attach('dispute-1', { ...base, contentHash: hashOf('more') }),
    ).resolves.toMatchObject({ hashVerified: false });
  });

  it('reports an unknown dispute as not found', async () => {
    const { service } = build();

    await expect(
      service.attach('missing', { ...base, contentHash: hashOf('x') }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.list('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DisputeEvidenceService.verify', () => {
  it('confirms matching content and remembers it', async () => {
    const { service, rows } = build();
    const evidence = await service.attach('dispute-1', { ...base, contentHash: hashOf('report') });

    const result = await service.verify('dispute-1', evidence.id, b64('report'));

    expect(result).toEqual({
      evidenceId: evidence.id,
      contentHash: hashOf('report'),
      computedHash: hashOf('report'),
      matches: true,
    });
    expect(rows[0].hashVerified).toBe(true);
    expect(await service.list('dispute-1')).toEqual([expect.objectContaining({ hashVerified: true })]);
  });

  it('reports a mismatch without clearing an earlier verification', async () => {
    const { service, rows } = build();
    const evidence = await service.attach('dispute-1', { ...base, content: b64('report') });

    const result = await service.verify('dispute-1', evidence.id, b64('tampered'));

    expect(result.matches).toBe(false);
    expect(result.computedHash).toBe(hashOf('tampered'));
    expect(rows[0].hashVerified).toBe(true);
  });

  it('does not find evidence through another dispute', async () => {
    const { service } = build();
    const evidence = await service.attach('dispute-1', { ...base, contentHash: hashOf('report') });

    await expect(service.verify('dispute-2', evidence.id, b64('report'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
