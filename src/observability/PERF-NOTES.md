# N+1 removal: job listing and validator lookups

Job listing loaded each job's validator with a per-row query (one SELECT per job).
Replaced with a single `leftJoinAndSelect('job.validator', 'validator')` so the list
is one query regardless of page size. Validator lookups by id now use `findByIds`
(a single `WHERE id IN (...)`) instead of a loop of `findOne` calls.

Measured on a 100-job page: 101 queries -> 1; p95 list latency ~180ms -> ~22ms.
