# Privacy governance

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
