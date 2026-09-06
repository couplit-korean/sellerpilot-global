# SellerPilot PostgreSQL core

`0001_core.sql`는 PPT 수용 범위의 초기 스키마 초안이다. 현재 운영 DB는 Supabase 프로젝트 `sqaoqucxakebqkiygdxb`이며 마이그레이션은 `supabase/migrations`가 원장이다. 운영 사실은 `docs/현재상태.md`를 본다.

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

운영은 Supabase Vault + Vercel이다. 유료 Vercel Static IP는 사용하지 않는다. 채널 개발자센터 화이트리스트에 관측 공인 IP를 등록한다.

Do not place seller API keys, refresh tokens, buyer data, or production connection strings in the repository or browser code.

