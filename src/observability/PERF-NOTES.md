# N+1 removal: job listing and validator lookups

Job listing loaded each job's validator with a per-row query (one SELECT per job).
Replaced with a single `leftJoinAndSelect('job.validator', 'validator')` so the list
is one query regardless of page size. Validator lookups by id now use `findByIds`
(a single `WHERE id IN (...)`) instead of a loop of `findOne` calls.

Measured on a 100-job page: 101 queries -> 1; p95 list latency ~180ms -> ~22ms.

# Validator set snapshots per epoch

Committee selection needs every staked, active validator, and `findEligible()`
read the whole `validators` table for each job (and again for each appeal
panel). `ValidatorSetCache` (`src/modules/validators/validator-set.cache.ts`)
keeps one snapshot per epoch (`VALIDATOR_SET_EPOCH_SECONDS`, default 30 s):

- one table read per epoch instead of one per job; concurrent callers that
  arrive during the read share it;
- registration, exit, stake changes, suspension and reactivation invalidate the
  snapshot immediately on the instance that performed them;
- changes made by another instance are seen at the next epoch at the latest,
  so `VALIDATOR_SET_EPOCH_SECONDS` is the bound on staleness (0 disables the
  cache).

`GET /validators/set` returns the snapshot in use, which is also what a third
party needs to recompute a committee draw.
