# 2026-09-13 병렬 작업 범위와 완료 예상 검토

기준 소스는 `/Users/kimchangheemac/dev/sellerpilot-app`, 검토 시작 HEAD는 `403a01c54dbc73a1103d4d3a7a5bf3986f09cf7b`다. 기존 Aside 로그인 탭을 유지한다. Shopee 새 로그인·OAuth·OTP를 다시 시작하라는 지시가 아니다.

## 닫힌 조사와 재작업 제외 범위

- 기존 HEAD의 동적 RPC 38곳은 37개 내부 전달부와 1개 유한 6동작 분기로 분류했다. 외부 입력으로 임의 RPC 이름을 고르는 지점과 미해결 이름은 0이다.
- 스캐너가 놓친 `requiredRpc(rpc,name)` 경유 runtime release 함수 4개를 추가하면 기존 호출 이름은 385개이며 운영 이름 누락은 0이다. 새 기능이 추가하는 함수는 별도 migration 대상으로 검증한다. 과거 96/71/38은 현재 미해결 개수가 아니다.
- 위 4개와 Shopee create-stage 분기 6개의 실제 운영 시그니처를 확인했다. 해당 집중 검사 17개가 통과했다. 스캐너 표현 개선은 긴급 복구 범위에서 제외한다.
- 기존 이미지 압축/상세페이지, eBay 승인, 이미 적용한 DB 복구를 다시 구현하지 않는다. 관련 코드가 바뀌거나 새 실패가 생길 때만 해당 회귀 범위를 다시 검사한다.

## 병렬 가능한 경계

| 작업 | 병렬 범위 | 한 담당자가 순서대로 처리할 범위 |
|---|---|---|
| Lazada 5개국 CS 연결 | 새 IM runtime/단발 실행기, 전용 migration/검사 | API·화면 연결, 실제 DB 적용, 승인 코드 소비, 5개국 실제 조회 |
| Shopee 저장 메인 토큰 복구 | 별도 runtime/ledger 설계와 집중 검사 | 기존 미확정 claim 대조, 토큰별 단일 호출, 저장·대상 신원 확인 |
| 11번가 배송 | 공식 발주/발송 명세 확인, 전용 mapper/검사 | 공통 작업 허용 목록·DB 변경, 실제 주문 발송 |
| Temu 일반 상담 | 로그인된 공식 API 계약·권한 확인 | 실제 고객 답변 전송과 원격 확인 |
| 공통 릴리스 | 소스 수정 종료 전 개별 검사 | 최종 빌드, Git, Vercel, Supabase 활성 버전, Mac 실행본 교체 |

새 checkout/worktree/사용자 작업을 만들지 않는다. 하위 작업은 지정 파일만 수정하고 서로 메시지를 보내지 않는다. 통합 담당자만 공통 DB·브라우저·릴리스를 변경한다.

## 구현·검증 중인 Lazada

현재 운영 credential v7의 메타데이터를 다시 조회했다. commerce 국가 5개, IM 국가 1개이며 DB 만료와 commerce refresh 만료는 모두 `2027-03-09T14:07:24.232Z`다. 이 실제 출발 상태로 신규 연결을 검사해야 한다.

새 IM 전용 화면/API/runtime/단발 실행기와 migration을 작성했다. OAuth app 137571 / country cb를 사용하며 기존 commerce app 137451의 토큰과 판매자 신원을 유지한다. 코드 한 번 소비, 반환 토큰의 Vault 복구 보관, 같은 토큰으로 5개국 읽기 확인 후 국가별 capability 저장을 분리한다.

통합 검사에서 prepare/bind/pulse 인자 불일치, 이미 IM 5개국이 있어야 시작되는 DB 조건, 복구 보관 전 국가/만료 검증으로 반환 토큰을 잃을 수 있는 조건을 찾아 수정했다. 최초 pulse는 기존 승인된 Lazada 로컬 실행 경로와 source/owner/worker/release/egress를 대조해 결속한다. 이후 정확한 5개국 읽기 확인 시 기존 승인 기간·동작·작업자·IP를 유지하며 새 credential로 로컬 실행 경로를 승계한다.

기존 단일 국가 전용 ingest readiness와 `min(country)` 기록도 수정했다. 단일 국가 기존 동작을 유지하며 5개국에서는 각 문의의 국가를 검증해 저장한다. history 요청 국가를 raw page에도 보존하고, 서명된 webhook은 IM 승인 국가·판매자까지 대조한다. 답변 인자에 문의 국가를 전달하며 일반 경로의 기존 ID 지원도 유지한다.

신규 DB migration `20260913104000`, `20260913111500`은 운영 적용됐고 version/name/저장 원문 SHA-256 2개가 소스와 일치했다. 첫 적용 전 검사에서 Vault 함수의 실제 4인자(default 포함) 시그니처와 3인자 가정의 불일치를 찾아 transaction 전체가 중단됐으며, 실제 시그니처로 수정·집중 검사 후 적용했다. 새 테이블 3개의 RLS·비공개 ACL과 공개 함수 4개의 service-only 실행 권한, 기존 MY readiness=true/v7 유지, 새 승인 세션 0개를 확인했다. [안전한 운영 검증 결과](20260913-parallel-critical-path.json). 새 앱 배포·실승인은 아직 남아 있다.

Supabase 보안 Advisor 조회에서 이번 변경 객체에 대한 지적은 0개다. 프로젝트 전체에는 기존 함수 실행 권한·비밀번호 보호 관련 경고 175개가 표시되며, 이 조회만으로 실제 취약점이나 이번 변경의 신규 문제로 분류하지 않는다. 변경 파일 28개의 비밀키 형식 검사에서 의심 항목은 없었다.

DB·API·실행기·runtime·기존 capability 집중 검사 36개, 영향 Lazada 회귀 58개, 신규·기존 ingest DB 검사 13개, 마지막 UI·API 검사 28개, 기존 답변 관련 29개와 신규 국가 인자 검사 3개가 통과했다(검사 범위에 중복이 있어 합산하지 않는다). 마지막 소스 변경 이후 운영용 Next 빌드도 통과했다. DB 검사는 실제 `lazada_im_secret_binding` 본문을 사용하지만 generic prepare/complete는 fixture adapter 경계이며, 해당 운영 helper 정의도 별도로 조회해 계약을 대조했다. 실제 provider 결과 저장까지 완료했다는 뜻은 아니다. 기존 전체 migration 검사에는 신규 migration 이전 fixture 목록·preimage 불일치가 남아 있어 전체 suite 통과로 보고하지 않는다.

통합 TypeScript 검사는 통과했다. 변경한 신규 파일의 ESLint 위반은 없으며 `app/page.tsx` 전체 검사에는 기존 HEAD에도 동일한 미사용 2개와 Hook 경고 1개가 존재한다. 이것을 새 변경의 통과나 전체 lint 통과로 바꾸어 표현하지 않는다.

19:58 KST 실제 운영 재조회: Mac gateway는 `191e5cc`/ready/HTTP 200, active job 0이다. Supabase 활성 SHA도 같고 blocking 0, 장기 트랜잭션 0, deadlocks 0이다. CS 원장의 Lazada 13건·eBay 21건은 시스템 알림이며 고객 문의·답변 완료 수로 세지 않는다.

## 새로 확정한 실제 미구현 범위

### Shopee

현재 일반 refresh는 대상별 refresh token을 사용하고, 기존 exact OAuth는 새 authorization code에서 시작한다. 저장된 `main_account_refresh_token`에서 대상별 durable 복구를 시작하는 경로는 없다. 기존 미확정 claim의 409는 유지해야 하며 메인 토큰을 다른 대상 token 필드에 복사하거나 claim을 지워 우회하지 않는다. 공급자 토큰 유효성과 과거 대상별 소비 여부는 저장 기간만으로 증명되지 않는다.

### 11번가 배송

`lib/shipping/channels/elevenst.ts`는 주문 조회만 구현했다. 발주/발송 transport, 품목 단위 mapper, 성공 후 readback은 추가 구현 대상이다. `order-sync.ts`의 주문 품목 식별도 발송 계약에 맞춰 보존해야 한다. 공식 주문 API 소개는 발주·발송 기능을 설명하지만, 정확한 endpoint/XML 계약은 로그인된 개발 가이드로 확보해야 한다.

공식 자료: <https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER>

### Temu 일반 구매자 상담

after-sales 조회와 일반 Buyer Chat 수신·답변은 다른 기능이다. 현재 일반 Buyer Chat 계약 allowlist가 비어 있고, 수신 정규화와 전송은 차단돼 있다. API router 주소나 `bg.tmc.message.update`라는 이름만으로 고객 답변 계약을 추정하지 않는다. 기존 로그인된 Temu 앱은 Approved 표시까지 확인했지만, 일반 상담 API type/권한/수신·답변·readback 명세는 아직 확보하지 못했다.

공식 자료: <https://partner.temu.com/documentation?menu_code=38e79b35d2cb463d85619c1c786dd303>

## 시간 산정의 범위

오늘 확인한 Git 기록은 00:03:43–19:16:16 KST, 경과 약 19시간 13분, 33커밋이다. 분류는 앱/runtime 21, 그 외 DB 6, 문서/설정 6이다. 이는 연속 실작업 시간이나 완료율이 아니므로 커밋 수로 남은 시간을 선형 계산할 수 없다.

- Shopee/Lazada 인증 복구 구현·통합 검증은 병렬 작업 예산으로 8–13시간을 보수적으로 잡는다. 실제 토큰이 유효하고 공식 승인이 가능한 조건이며 완료 보장이 아니다.
- 11번가 배송은 공식 계약 확보 뒤 구현/검사 6–10시간, 실제 유효 주문 확인과 배포 1–3시간의 별도 예산이다. 다른 채널 구현과 일부 병렬 가능하다.
- Temu 일반 상담은 공식 API 계약이 없어 완료 시간 산정이 아직 불가능하다.
- 전체 8채널의 실제 신규 상품 등록·고객 답변·배송 검증은 유효한 대상과 공급자 응답이 필요하다. 현재 중앙 원장에 실행할 대상이 없다는 사실로 판매자센터 전체가 비었다고 판단하지 않는다.

따라서 이전의 6–10시간을 전체 기능 완료 약속으로 사용하지 않는다. 실제 구현 공백과 외부 대기 조건을 포함한 현재 범위를 위 표로 관리한다.
