# SellerPilot PostgreSQL core

`0001_core.sql` is the production data contract for the PPT-based acceptance scope. It is intentionally not connected to the public demo deployment yet.

## Guarantees encoded in the schema

- Every operational record is scoped by `organization_id`.
- Channel secrets are never stored directly; `channel_accounts.credential_secret_ref` points to a managed secret store.
- Inventory is append-only through `inventory_ledger` and deduplicated by `idempotency_key`.
- Orders and inbound events have channel-level uniqueness constraints to prevent webhook/polling duplication.
- Background work has explicit retry state, maximum attempts, lock ownership, and attempt evidence.
- Product facts, source assets, derived content, compliance decisions, and channel mappings are versioned separately.
- Buyer, shipping, and customer message data is represented as encrypted payloads.
- `acceptance_evidence` stores real verification evidence separately from development status.
- Row-level security is enabled on tenant-sensitive tables before application grants are added.

## Required provisioning decisions

Before applying this migration, choose a PostgreSQL provider, private connection method, managed secret store, object storage, queue/scheduler, fixed egress IP, backup policy, and monitoring service. Development, staging, and production must use separate databases and credentials.

Do not place seller API keys, refresh tokens, buyer data, or production connection strings in the repository or browser code.

