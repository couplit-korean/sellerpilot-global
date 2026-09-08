# 공통 변경 요청 elevenst-003

- 목적: 11번가 긴급알리미 GET의 정상 빈 응답과 미파싱 응답을 구분하고, 고객 문의와 시스템 알림을 분리된 읽기 전용 CS 이력으로 투영한다.
- 요청 채널 / S0: `elevenst` / `S0-20260908-decaba426812a3ba`
- 선행 전용 델타: `lib/channels/cs/elevenst/contracts.ts`와 보완 델타의 `lib/channels/elevenst-inquiries.ts`가 먼저 존재해야 한다.
- 정확한 적용 패치: `elevenst-003-alimi-get-common.patch`

## 현재 통합본 preimage와 제안 after

| 파일 | before SHA-256 | after SHA-256 |
|---|---|---|
| `lib/channels/protocols.ts` | `8f2bbead6f2c6935c64ecd79cb5e27c1e22132a115f6a05b2d9277f68bf0ec1a` | `983b3157d794fab27dba2ba03026778ad86abd77916480f59ea6e8320ac59c2d` |
| `lib/channels/inquiry-sync.ts` | `c8d1caa1365246db9fbd500a9af97efdd82c630c40d098da13075aa81c24b464` | `4e32b5e2d53701ad587fe8cb8374c457d13cc2263beead7f449ad9db8b226f50` |
| `lib/cs/capability-inventory.ts` | `a0e72d200e7d7cc6ab22c47c74be31875b3c2a161672467cc53beca0b86f763e` | `4627ecd29c07121ac050ed5e45ec02f7e23031eef3a2f99ad8dc8df244f68df5` |
| `tests/cs-elevenst-alimi-common-integration.test.ts` | 없음 | `a664c1cf8056c5e0251292e2e6fdcbbe5a38b9f5f05b443a2499e9423a5c30a3` |

해시가 하나라도 다르면 자동 적용하지 말고 현재 통합본에 다시 재기반해야 한다.

## 계약과 안전 경계

- parser는 GET 경로가 `/rest/alimi/getalimilist/`일 때만 `alimListInfos`와 `sellerpilot-elevenst-alimi-parser/1` 마커를 낸다.
- 5,001행 이상은 5,000행으로 자르지 않는다. `accepted=false`, `sellerpilotElevenstAlimiParseIncomplete=true`, 관측 행 수와 `ELEVENST_ALIMI_ROW_LIMIT_EXCEEDED`를 반환한다.
- `result_code=0` 또는 결과 코드 없이 실제 행이 있는 경우만 수락한다. 음수·기타 업무 코드는 실패다.
- `memId`, `memNm`은 parser 출력에 포함하지 않는다.
- `emerNtceClfNo1=10`은 고객 문의, `11`은 시스템 알림으로 분리한다.
- 기존 답변에 제공자 시각이 없으면 seller 메시지 시각을 만들지 않고 `unsequencedReplies`로만 보존한다.
- 현재 상태 `02` 또는 `04`는 과거 답변 존재 여부와 무관하게 waiting이다. `03`, `05`, `06`만 resolved로 투영한다.
- 수집 전용 단계에서는 provider 응답 유형과 무관하게 `replySupported=false`다.
- 이 패치는 GET 수신·이력만 연다. 긴급알리미 PUT 답변은 승인 티켓, action별 ACK, 동일 ID 원격 재조회가 연결될 때까지 닫아 둔다.
- Product Q&A 경로와 `resultCode=500` 실패 의미는 변경하지 않는다.

## 검증

- 제안 패치를 현재 통합본 복제본에 적용한 뒤 신규 공통 통합 시험 2/2 통과.
- 보완 델타와 Product Q&A 회귀를 함께 실행해 23/23 통과.
- 통합 담당이 Qoo10 `TS2339` 세 건을 별도로 수정한 현재 통합본을 반영한 임시 복제본에서 전체 `tsc --noEmit`이 통과했다.
- 검증 명령: `node --import tsx --test tests/cs-elevenst-alimi-common-integration.test.ts tests/cs-elevenst-alimi-adapter.test.ts tests/cs-elevenst-contracts.test.ts tests/cs-elevenst-read-model.test.ts tests/cs-elevenst-isolated-db.test.ts tests/elevenst-product-qna.test.ts`

## 통합 후 남는 일

- 전용 읽기 상태 모델 `lib/cs/channels/elevenst/read-model.ts`을 공통 CS 화면의 상태 카드에 연결한다.
- 전용 격리 DB guard `lib/cs/channels/elevenst/isolated-db.ts`를 동적 DB 시험 시작 전에 호출한다.
- 운영 DB migration과 실행 플래그는 통합 담당 소유이며 이 제안에는 포함하지 않는다.
