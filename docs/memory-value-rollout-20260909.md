# Memory-value rollout candidate — 2026-09-09

Status: local candidate only; not released and no production backfill performed.

The user subsequently authorized production release with the 4 GB Worker heap retained. Planned deployment keeps the governed-memory feature off until the account cohort is approved. Persist the existing heap option via `NODE_MEMORY_WORKER_NODE_OPTIONS="--max-old-space-size=4096 --heapsnapshot-signal=SIGUSR2"`, and set `NODE_MEMORY_MAX_RSS_MB=4608`, `NODE_MEMORY_MIN_AVAILABLE_MB=2048` in the production environment file. These are distinct budgets: old-generation heap, process RSS and system headroom. Preserve backups and certificate hashes; do not rebuild the gateway for this release.

## Controls

- `NODE_MEMORY_VALUE_MODE=shadow|active` and `NODE_MEMORY_VALUE_USER_IDS=<comma-separated Mongo user IDs>` must both be configured in Web and memory Worker. Missing or invalid mode, empty scope, absent user ID, and wildcard do not enable any account.
- `shadow` writes only its audit, then continues legacy memory processing. Shadow model failures also continue legacy processing, including messenger conversations. Promotion from a shadow audit replans against current facts rather than applying stale proposals.
- `active` substitutes the governed path only for allowlisted accounts. The same account gate controls profile-fact extraction, account-fact reads and semantic indexing.
- Backfill is separate and remains stopped. Its explicit `--apply=yes` additionally requires active mode and account IDs; the checkpoint binds that account scope. Do not reuse a checkpoint for a different cohort.
- Turning the mode off stops new governed processing but does not undo facts already written. Code rollback is not a data rollback; retain source evidence and audits.

## Acceptance evidence and limits

- Node compilation with a 1536 MB heap cap, maintenance-script syntax check and `git diff --check` passed. The relevant 11 unit suites passed 118 tests; the isolated MongoDB integration test passed separately with both deterministic adapters and the real-model option. Existing unrelated messenger interview baseline failures described in the earlier report remain outside this pass count.
- Automated coverage includes exact account scope, no wildcard fallback, direct-call refusal outside scope, and shadow success/failure for both ordinary relatives and messengers.
- An isolated, memory-limited local MongoDB test exercises persistence, idempotent replay, global-name projection, profile generation, reply identity context and revoked-evidence filtering.
- The same synthetic input also passed using real Qwen Plus for extraction/review, profile synthesis and a subsequent answer containing the persisted name and childhood event. The first live run failed on an invalid enum. Field-specific validation feedback was added without relaxing enums or increasing retries. A subsequent run reached three legitimate decisions rather than a fixed expected two; the test now checks retained facts and idempotence instead of prescribing the model's number of decisions.
- Vector transport is a test adapter. Real Milvus ANN recall, the full production chat response pipeline, and sustained production resource stability are NOT yet verified by this test. Passing the test is not a production acceptance claim.
- The temporary MongoDB container and synthetic database were cleaned up after the test.

## Production preflight

Read-only check: branch `20260907`, commit `f8fd5118a4a01baee1c970c38dc3ad9b88c354c6`.

The production working tree contains certificate changes and an independent one-line Compose override setting the memory Worker heap to 4096 MB. The existing release helper refuses non-certificate working-tree changes. Do not reset or overwrite this override, move its backup, or widen the release bypass without explicit authorization. No production configuration was changed by this work.

Release closure for this candidate is Node, memory Worker and admin Node because shared entity fields changed; admin Web and gateway are not in the intended closure. Account selection and production write verification must be explicitly scoped before activation. Historical backfill is not part of that activation.
