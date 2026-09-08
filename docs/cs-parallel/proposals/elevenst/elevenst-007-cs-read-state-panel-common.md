# 공통 변경 요청 elevenst-007

- S0: `S0-20260908-decaba426812a3ba`
- 선행 전용 파일: `app/cs/channels/elevenst/read-state.tsx`, `lib/cs/channels/elevenst/read-state-contract.ts`
- 기존 API 재사용: `/api/admin/cs/channels/elevenst/read-state`
- 정확한 patch: `elevenst-007-cs-read-state-panel-common.patch`
- patch SHA-256: `732a2a79b89023e34ac436ba050dfcbacbb98f62b150d36033aa1a9b0a0b3cc7`

## 연결 범위

새 API를 만들지 않는다. 이미 통합된 인증 Route Handler가 호출하는 `sellerpilot_read_elevenst_cs_read_state_v1('couplit')` 결과를 엄격한 client 계약으로 검사하고 기존 `/cs` 화면에 panel만 연결한다.

- 판매자 범위는 `couplit` / `커플릿`만 허용한다.
- Product Q&A와 긴급알리미를 서로 다른 surface로 표시한다.
- provider 업무 오류·인증 오류·미응답은 `remoteCount=null`, `emptyConfirmed=false`, `preserved_unverified`만 허용한다.
- 정상 0건만 `remoteCount=0`, `emptyConfirmed=true`로 표시한다.
- `storedCount`는 별도 UI 집계가 아니라 RPC가 같은 `sellerpilot_private.support_tickets` 원장에서 계산한 값이다.
- 수동 펼침/조회, `cache=no-store`, 이전 요청 abort, unmount abort를 사용한다. 답변은 항상 비활성이다.

## 최신 통합본 preimage / 제안 after

| 파일 | before SHA-256 | proposed after SHA-256 |
|---|---|---|
| `app/cs/archive.tsx` | `fc989d35678d98f89f782d8508b9c21c5e99a821df054bdc63d29d377ff4fec0` | `9989494b9d6825fb4a9d71f24eddfedd375858f1305f5ebe535632ab1a49a82a` |

패치는 현재의 `ShopeeHistoryProgress`를 포함한 최신 화면 preimage에 최소 import/render 두 줄만 추가한다. preimage가 다르면 재베이스한다.

## 인증·DB·UI 반례

- 무인증 401, 잘못된 bearer 401, 인증 200.
- seller ID 불일치와 `emptyConfirmed` 모순 payload는 client schema가 거절한다.
- Product Q&A 업무 500은 원격 `0건`이 아니라 `미확정`, 기존 원장 4건은 별도로 렌더한다.
- 긴급알리미 정상 0건은 원격 0건, 같은 원장의 저장 건수는 별도로 렌더한다.
- PGlite 시험은 projection의 두 `storedCount`를 동일 `support_tickets` SQL 집계와 직접 대조한다.
- 인증 스모크는 실제 Next dev/포트 3214에서 API 응답을 UI HTML로 렌더하며 token 비노출을 검사한다.

운영 DB, provider, 고객 답변, 배포에는 적용하지 않았다.
