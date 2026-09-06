# Security incident response

> 운영 사실(연결·IP·배포 SHA)은 [docs/현재상태.md](./현재상태.md)가 원장이다. 이 파일은 당시 기획/검수 스냅샷이다.

Owner: SellerPilot service operator
Review cadence: every six months and after each incident
Last reviewed: 2026-08-18

1. Contain suspected unauthorized access by revoking affected channel credentials, worker tokens, and active sessions.
2. Preserve relevant audit records without copying access tokens, passwords, or full customer payloads.
3. Determine affected sellers, channels, data fields, countries, and time window.
4. Notify the affected marketplace within its contractual deadline. For a confirmed Temu personal-data incident, send an initial notice within 24 hours of awareness, followed by containment and remediation updates.
5. Notify affected data subjects or regulators when law or marketplace instructions require it.
6. Rotate secrets, close the root cause, verify isolation and retention controls, and record corrective actions.

Incident notices must include a concise timeline, affected data categories, likely impact, containment actions, and the operator’s next update time. Secrets and unnecessary personal data must never be included in notices.
