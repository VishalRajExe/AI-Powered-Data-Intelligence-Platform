# J. No-Redis Job Architecture

Redis is excluded. In the old project Redis was load-bearing in **four** separate subsystems, so
removing it is four replacements, not one. This is the part of the rebuild most likely to be
underestimated.

| # | Old Redis usage | Evidence | Replacement |
|---|---|---|---|
| 1 | BullMQ queue `workflow-runs`, worker concurrency 2 | `queue/workflowQueue.ts`, `server.ts:71-79` | MySQL `workflow_jobs` + Spring `ThreadPoolTaskExecutor` |
| 2 | Per-domain rate limiting via a Lua sliding window (`ZREMRANGEBYSCORE`/`ZCARD`/`ZADD`), **fails closed when Redis is down** | `sources/RateLimitService.ts:13-36` | Bucket4j in-memory (single node) + `source_domain_policy` config |
| 3 | SSE cross-process fan-out via pub/sub channel `aidp:run:${runId}:events` | `monitoring/event-broadcaster.ts`, `Memory.md:63` | In-process `ApplicationEventPublisher` + `SseEmitter` registry, with `activity_events` as durable truth |
| 4 | Refresh-token revocation `aidp:revoked_token:<jti>` | `auth/token.service.ts:133-139,145-155` | MySQL `refresh_tokens` table |

Also relevant: anakin — the repo the brief nominates as the job-architecture reference — **uses
no Redis at all** (`README.md:47`: "no Redis, no AWS, no message queues"), so its architecture
already matches our constraint. But it has **no durable queue either**: its "queue" is an
in-process Go channel (`worker/worker.go:20-36,60-62`), Postgres is only a state store, and grep
confirms no `FOR UPDATE`, no `SKIP LOCKED`, no advisory lock and no version column anywhere in
`server/`. We must **add** the durability layer it lacks.

---

## J.1 The queue: MySQL `workflow_jobs`

Schema in `E-database-model.md` §E.2. The four columns that make it a real queue rather than a
status table:

| Column | Purpose |
|---|---|
| `scheduled_for` | when the job becomes eligible (delayed start, retry backoff) |
| `lease_expires_at` | crash detection — a dead worker's lease expires and the job is reclaimable |
| `worker_id` | which node/thread holds it, for diagnosis |
| `version` | optimistic lock, so two threads cannot both believe they own it |

Plus `attempt_count` / `max_attempts` / `next_retry_at` — all three absent in anakin, where the
retry count lives only in a loop variable and a failed job is terminal forever
(`processor.go:139-179`).

## J.2 Claiming a job without double-processing

The brief is explicit: *never create two workers that can accidentally process the same job
simultaneously without protection.* Two supported mechanisms — pick one and use it everywhere.

**Primary: atomic conditional UPDATE (single round trip, no explicit transaction).**
```sql
UPDATE workflow_jobs
   SET status           = 'RUNNING',
       worker_id        = :workerId,
       locked_at        = NOW(6),
       lease_expires_at = TIMESTAMPADD(SECOND, :leaseSeconds, NOW(6)),
       attempt_count    = attempt_count + 1,
       started_at       = COALESCE(started_at, NOW(6)),
       version          = version + 1
 WHERE id = (
         SELECT id FROM (
             SELECT id
               FROM workflow_jobs
              WHERE status = 'PENDING'
                AND scheduled_for <= NOW(6)
              ORDER BY priority, scheduled_for, created_at
              LIMIT 1
         ) AS candidate
       )
   AND status = 'PENDING'
   AND version = :expectedVersion;
```
`affected rows == 1` ⇒ this worker owns the job. `0` ⇒ someone else won; loop and try again.
The trailing `AND status='PENDING'` is what makes it race-free even if the subquery is stale.
(MySQL requires the extra derived-table wrapper because a table cannot be updated while
selecting from it directly in the same statement.)

**Alternative: `FOR UPDATE SKIP LOCKED` (MySQL 8.0.1+) — better for claiming a batch.**
```sql
START TRANSACTION;
SELECT id, payload
  FROM workflow_jobs
 WHERE status = 'PENDING' AND scheduled_for <= NOW(6)
 ORDER BY priority, scheduled_for, created_at
 LIMIT :batchSize
 FOR UPDATE SKIP LOCKED;      -- concurrent claimers skip already-locked rows, never block
UPDATE workflow_jobs SET status='RUNNING', worker_id=:w, locked_at=NOW(6),
       lease_expires_at=TIMESTAMPADD(SECOND,:lease,NOW(6)), version=version+1
 WHERE id IN (:ids);
COMMIT;
```
Keep the transaction **short** — claim and commit, then execute outside it. Never hold row locks
across an HTTP call to Python or Firecrawl.

Required index (without it, every claim scans):
```sql
CREATE INDEX idx_jobs_claim ON workflow_jobs (status, scheduled_for, priority, created_at);
```

## J.3 Lease renewal and stale recovery

A long extraction step can outlive a naive lease, so:

- **Heartbeat**: while executing, renew `lease_expires_at` every `leaseSeconds/3` in a separate
  transaction. If renewal finds the row no longer ours (`version` changed), abort — we lost the
  lease and must not keep writing results.
- **Sweeper** (`@Scheduled(fixedDelay = 30s)`): reclaim jobs whose lease expired.
```sql
UPDATE workflow_jobs
   SET status = 'PENDING', worker_id = NULL, locked_at = NULL, lease_expires_at = NULL,
       scheduled_for = NOW(6), version = version + 1
 WHERE status = 'RUNNING'
   AND lease_expires_at < NOW(6)
   AND attempt_count < max_attempts;

UPDATE workflow_jobs
   SET status = 'FAILED', last_error_code = 'LEASE_EXPIRED_EXHAUSTED',
       finished_at = NOW(6), version = version + 1
 WHERE status = 'RUNNING'
   AND lease_expires_at < NOW(6)
   AND attempt_count >= max_attempts;
```
This is the capability anakin entirely lacks — on crash its rows stay `pending`/`processing`
forever with no sweeper and no heartbeat.

The same sweeper fixes the old project's stranded **export** jobs
(`export.service.ts:41-53` used in-process promises, so a restart left them `RUNNING`
permanently) and enforces the `expires_at` / `EXPIRED` transition the old schema defined but
never implemented.

## J.4 Retry with real backoff

Anakin retries immediately with no backoff and never persists the attempt count; the old project
configured no queue-level `attempts` at all. Ours:

```
delay = min(maxDelaySeconds, baseSeconds * 2^(attempt_count - 1))  +  jitter(0 .. 0.3 * delay)
next_retry_at = NOW(6) + delay
status = 'PENDING', scheduled_for = next_retry_at
```
Jitter is not optional: without it, N sources that fail together (a rate-limit burst) all retry
at the same instant and re-trigger the same limit.

Only errors in the plan's `retryableErrors` whitelist are retried —
`TIMEOUT`, `RATE_LIMIT`, `TRANSIENT_NETWORK`, `SERVER_ERROR`. A robots disallow, an SSRF
rejection or a schema-validation exhaustion is **not retryable**; it becomes `BLOCKED`/`FAILED`
with a reason, per the brief's status vocabulary.

## J.5 Executor configuration

```java
@Bean("workflowExecutor")
ThreadPoolTaskExecutor workflowExecutor() {
    var ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(props.getCorePoolSize());        // default 4  (anakin: WORKER_POOL_SIZE=5)
    ex.setMaxPoolSize(props.getMaxPoolSize());          // default 8
    ex.setQueueCapacity(props.getQueueCapacity());      // default 100 (anakin: JOB_BUFFER_SIZE=100)
    ex.setThreadNamePrefix("wf-job-");
    ex.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy()); // backpressure
    ex.setWaitForTasksToCompleteOnShutdown(true);       // drain, don't drop
    ex.setAwaitTerminationSeconds(60);
    return ex;
}
```
- `CallerRunsPolicy` reproduces anakin's backpressure: its `Submit` is a **blocking channel
  send**, so a full buffer stalls the HTTP request rather than shedding work
  (`worker/worker.go:60-62`).
- The poller that feeds this executor is a `@Scheduled` loop calling the claim query, not a
  blocking consumer — with MySQL there is no push, so we poll (200-500ms) and claim in small
  batches.
- **Virtual threads** (`spring.threads.virtual.enabled=true`) suit the step executors, which are
  IO-bound on HTTP to Python and Firecrawl. Keep the *claim* loop on a small bounded platform
  pool so concurrency stays controllable.
- Per-step timeout: wrap the Python call in Resilience4j `TimeLimiter` using the plan step's
  `timeoutMs` (bounded 1s-300s by the plan schema).
- Per-domain concurrency: a `Semaphore`/Bulkhead keyed by domain, sized from
  `source_domain_policy.max_requests_per_minute`.

## J.6 Terminal-state writes must use a fresh transaction

The most valuable operational insight in any of the four repos. Anakin's `persistCtx`
(`processor.go:24-33`) writes final state with `context.WithoutCancel(ctx)` plus a fresh 5s
timeout, because the job context is *already expired* when recording the failure — otherwise,
in its own words, "a job that timed out stays stuck in 'processing' forever".

Spring equivalent:
```java
@Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 5)
public void finalizeJob(String jobId, JobOutcome outcome) { … }
```
Never write the terminal state inside the transaction or context that just timed out or was
cancelled. This applies to `FAILED`, `CANCELLED` and lease-loss paths especially — exactly the
paths where the old project stranded state.

## J.7 Batch fan-out and completion rollup

Per-source collection uses the parent/child pattern anakin models well
(`scraper.go:236-301`, `postgres.go:136-174`): a `SOURCE_COLLECT` parent job plus one child per
cleared URL, linked by `parent_job_id`. Children are ordinary jobs — the parent is never
"executed", only rolled up.

Anakin's rollup reads child counts then writes the parent status without locking, so two
concurrent last-children can both roll up. Make it atomic:
```sql
UPDATE workflow_jobs p
   SET p.status = CASE
         WHEN EXISTS (SELECT 1 FROM (SELECT * FROM workflow_jobs) c
                       WHERE c.parent_job_id = p.id
                         AND c.status IN ('PENDING','RUNNING'))
         THEN 'RUNNING'
         WHEN EXISTS (SELECT 1 FROM (SELECT * FROM workflow_jobs) c
                       WHERE c.parent_job_id = p.id AND c.status = 'FAILED')
         THEN 'PARTIAL_OR_FAILED'      -- resolved in Java against the run's counters
         ELSE 'COMPLETED'
       END,
       p.finished_at = NOW(6), p.version = p.version + 1
 WHERE p.id = :parentId;
```
or simply `SELECT … FOR UPDATE` the parent row inside the rollup transaction. Note MySQL's
restriction on selecting from the table being updated — hence the derived-table wrapper.

The run's own counters (`records_found`, `valid_count`, `duplicate_count`, `sources_processed`,
`sources_failed`) are updated in the same transaction, and `progress` is derived from real step
states — never the old `COMPLETED→100, RUNNING→50, else 0` synthesis
(`workflows.routes.ts:92`).

## J.8 Cancellation

Cooperative, at step boundaries, exactly as before (and an inherited limitation worth stating
rather than hiding): `POST /runs/{id}/cancel` sets `cancel_requested_at` immediately; the
executor checks it before each step and between retries; an in-flight HTTP call finishes under
its own timeout because Firecrawl exposes no run-level abort (`Memory.md:114`). The run then
transitions to `CANCELLED`. Additionally, unstarted `PENDING` jobs for that run are moved
straight to `CANCELLED` so the sweeper does not resurrect them.

## J.9 Idempotency

The old queue used `jobId = runId` (`workflow-execution.service.ts:32`), which made enqueue
idempotent but also meant **a failed run could never be re-enqueued under the same id**. Avoid
both problems:

- Job ids are fresh UUIDs; idempotency comes from a **unique key on the intent**, e.g.
  `UNIQUE (run_id, step_key, attempt_number)` for step jobs, so a duplicate insert is a no-op.
- Every state mutation carries `WHERE status = <expected> AND version = <expected>`.
- `SAVE` is idempotent by construction: it upserts the dataset keyed on `workflow_run_id`
  (already `UNIQUE`), so a replayed SAVE cannot duplicate rows.
- Step execution records a `result_summary`; a reclaimed job whose step already reached
  `COMPLETED` is skipped rather than re-executed (avoids re-spending Firecrawl credits after a
  lease loss).

## J.10 Rate limiting without Redis

The old limiter used a Redis Lua sliding window and **failed closed when Redis was unavailable**
— a correct instinct. Replacement:

- **Bucket4j in-memory** per domain, capacity from `source_domain_policy.max_requests_per_minute`
  (plan-bounded to ≤60), with robots `crawl-delay` as a floor.
- **Fail closed** on any limiter error, preserving the original semantics.
- **Documented limitation:** in-memory buckets are per-JVM. On a single node this is exact; with
  N nodes each spends its own budget, silently multiplying the real request rate against a
  source. That is a governance violation, not just an inaccuracy — which is a second hard reason
  v1 is single-node (`A` §A.4).
- If multi-node is ever required, the correct no-Redis answer is a **MySQL token bucket** (one
  atomic `UPDATE … SET tokens = …` per acquisition) or moving limits to a gateway — not
  reintroducing Redis.

The separate HTTP API rate limiter (auth 15/min, workflow 30/min, with 429 + `Retry-After`) was
already in-memory in the old project (`common/rateLimiter.ts`), so it ports directly to Bucket4j.

## J.11 SSE without Redis pub/sub

`activity_events` remains authoritative and is written **before** any broadcast — the old
project's best monitoring decision (`event-broadcaster.ts:56-99`). On top of it:

- An in-process `SseEmitter` registry keyed by `runId`.
- On connect: replay from `activity_events` honouring `Last-Event-ID` (bounded to the last ~500),
  then stream live. Because the log is durable, reconnect and post-restart replay are correct
  **regardless** of topology.
- `: ping` heartbeat every 15s; close on terminal status.
- `ApplicationEventPublisher` bridges the worker thread to the emitter registry **within the same
  JVM**. Without Redis there is no cross-process bridge, so the worker and the API must share a
  process. That is the single-node constraint, stated plainly.
- The old code swallowed Redis publish failures (`event-broadcaster.ts:93-95`). With no Redis
  there is nothing to swallow — but a failed emitter registration must still be logged, and the
  client falls back to polling `GET /runs/{id}` via TanStack Query.

## J.12 Token revocation without Redis

`refresh_tokens` table (§E.2). Revocation is a row update, so it is durable and survives
restart — strictly better than the old in-memory Set with optional Redis whose failures were
**silently swallowed** (`token.service.ts:133-139,145-155`), meaning logout could degrade to
per-process memory with no signal.

Access tokens stay short-lived (15 min). Revocation is checked on refresh; presenting an already
revoked `jti` sets `reuse_detected_at` and invalidates the whole chain (the old system rotated
and revoked but never detected replay). A scheduled purge deletes rows past `expires_at`.

## J.13 Graceful shutdown

Anakin's ordering is right and ports directly (`cmd/server/main.go:182-210`):
**stop ingress → cancel background → drain workers → stop subsystems.**

Spring: `SmartLifecycle` phases — (1) stop accepting new HTTP requests, (2) stop the claim
poller, (3) `ThreadPoolTaskExecutor` with `waitForTasksToCompleteOnShutdown(true)` and a bounded
`awaitTermination`, (4) release leases on anything still running so another node can claim it
immediately instead of waiting for expiry, (5) close the datasource last.

Releasing leases on shutdown is the difference between a redeploy that resumes in seconds and
one that stalls for a full lease timeout.

## J.14 Summary of what anakin taught us — and what it did not

| Adopted (concept only, independently implemented — AGPL) | Added because anakin lacks it |
|---|---|
| Job table information set; parent/child batch model with count-based rollup; status vocabulary; pool sizing + bounded buffer for backpressure; per-job timeout; executor flow (claim → chain → validate → store → complete/fail); `persistCtx` fresh-context terminal writes; sync-poll endpoint with 408 + job id; deterministic content-quality detector with `ShouldRetry`; handler chain with fallback; SSRF guard incl. dial-time rebinding protection; domain-config cache with 60s refresh; graceful-shutdown ordering; sidecar watchdog pattern | `FOR UPDATE SKIP LOCKED` / atomic conditional-UPDATE **claim**; **lease + heartbeat**; **stale-job recovery sweeper**; **persisted** `attempt_count` / `next_retry_at` with **exponential backoff + jitter** (anakin retries immediately and never persists the count; its `MAX_JOB_RETRIES` env is dead config); **declarative transition enforcement** (anakin's status is a bare `VARCHAR(20)` with no guard); **atomic** batch rollup (anakin's read-then-write races); export-job expiry enforcement |

Next: `K-environment-variables.md`.
