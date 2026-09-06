# Privacy governance

> 운영 사실(연결·IP·배포 SHA)은 [docs/현재상태.md](./현재상태.md)가 원장이다. 이 파일은 당시 기획/검수 스냅샷이다.

Owner: SellerPilot service operator
Review cadence: every six months, and whenever a processor, data purpose, region, or marketplace integration changes
Last reviewed: 2026-08-18

- Collect only fields required for listing, order fulfilment, support, security, and reconciliation.
- Keep seller credentials in the encrypted Vault and never place secrets in client-visible snapshots or logs.
- Separate each seller’s records by owner and restrict administrative functions to explicit administrators.
- Anonymize direct identifiers in completed orders and resolved support cases within 30 days after the operational purpose ends.
- Delete completed channel-gateway payloads and AI work files within the same 30-day retention boundary.
- Coordinate access, correction, deletion, and restriction requests through the originating marketplace or the operator’s contractual contact.
- Record retention runs and security-relevant changes using non-personal audit details.
