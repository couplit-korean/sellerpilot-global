# 쿠팡 CS 6차 보완: local read proposal 실행 가능성

- 시각: 2026-09-08 23:45 KST
- S0: `S0-20260908-decaba426812a3ba`
- 대상: proposal `coupang-008`
- 운영 변경: DB/route/job/provider/credential/reply mutation 0

## 결과

- 설명용이던 JS patch를 최신 통합본 preimage에 실제 `git apply --check` 가능한 unified diff로 교체했다.
- production에서 읽은 access/job predicate/claim/constraint MD5 네 값은 SQL 파일에 그대로 유지했다.
- 정본 local-executor migration의 fixture와 최종 wrapper 체인을 PGlite에 설치하고 008 SQL의 preflight, constraint 교체, access 함수 교체, postflight, commit까지 실행했다.
- PGlite는 `pg_get_functiondef`와 `pg_get_constraintdef`의 직렬화가 production PostgreSQL과 달라 digest가 다르다. 시험은 production digest와 PGlite 정본-chain digest 양쪽을 고정한 뒤 실행 복사본의 네 digest 상수만 치환했다. SQL의 권한과 동작 본문은 변경하지 않았다.
- migration 전후 `local_channel_executor_routes`는 0건으로 유지됐다.

## 권한·claim 반례

- 허용: `coupang:inquiries.list = read` 한 종류.
- 계속 차단: `coupang:inquiries.reply`, `orders.list`, `shipment.confirm`, `listing.update`, `smartstore:inquiries.list`.
- valid claim: exact seller key, credential, production environment, active release, current egress, active gateway token, fresh enabled route가 모두 맞는 `inquiries.list` 한 건.
- claim 0: seller mismatch, credential mismatch, route release mismatch, route egress mismatch, revoked/expired token, expired/disabled route.
- claim 0: read job에 `listing_id` 또는 external-detail binding이 있거나 금지 tuple 중 하나로 바뀐 경우.
- route row 자동생성: 0.

## 시험

- `tests/cs-coupang-read-only-runtime-db.test.mjs`: 3/3, skip 0, exit 0.
- `tests/cs-coupang-read-only-runtime-proposal.test.mjs`: 2/2, skip 0, exit 0.
- 두 파일 ESLint: exit 0.
- latest integrated preimage 대상 `git apply --check`: exit 0.

이 결과는 실행 경로가 안전하게 열릴 수 있음을 증명하지만 실제 route 활성화나 OpenAPI GET 완료 증거는 아니다. 배포·migration·route 생성은 사용자 금지 범위로 계속 남아 있다.
