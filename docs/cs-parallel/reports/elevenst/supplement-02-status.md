# 11번가 CS 보완 델타 02 상태

- 보완 델타 ID: `elevenst-supplement-02-20260908`
- S0: `S0-20260908-decaba426812a3ba`
- 1차 보완 대체: 통합 시 `supplement-01`의 변경 파일 대신 이 델타를 사용한다.
- 통합본 직접 수정: 없음
- 운영 변경: 없음

## 리뷰 차단 결함 수정

1. 긴급알리미 parser는 전체 `alimListInfo` 수를 먼저 센다. 5,001행 이상이면 빈 배열과 함께 관측 행 수, `ParseIncomplete=true`, `ELEVENST_ALIMI_ROW_LIMIT_EXCEEDED`를 반환하고 `accepted=false`가 된다.
2. 긴급알리미 현재 상태가 `02` 또는 `04`이면 과거 답변이 존재해도 waiting이다. `03`, `05`, `06`만 resolved다.
3. 현재 단계는 GET 수집만 열므로 모든 긴급알리미 투영의 `replySupported`는 `false`다. provider 응답 유형이 답변 요청형이어도 PUT 개방으로 표시하지 않는다.

## 실제 격리 DB에서 인증 웹까지

- 실제 PGlite 메모리 DB에 couplit 읽기 상태 fixture를 넣었다.
- loopback Supabase Auth/PostgREST 계약 서버가 실제 `authenticateAdminRequest`의 토큰 및 관리자 검사를 처리했다.
- Next.js 16 dev server로 전용 GET route를 `127.0.0.1:3214`에 연결해 HTTP로 호출했다.
- Bearer 없음 `401`, 잘못된 Bearer `401`, 유효한 일회성 격리 Bearer `200`이었다.
- 인증 성공 뒤 DB read는 정확히 1회였다. route application write, 운영 DB write, provider write는 모두 0회였다.
- 반환은 Product Q&A `business_error/remoteCount=null/emptyConfirmed=false`, 긴급알리미 `empty/remoteCount=0/emptyConfirmed=true`였다.

이 검증은 격리 인증 체인의 실제 실행 증거다. 운영 Supabase 사용자 인증이나 운영 RPC 적용 증거는 아니다.

## 검증

- 리뷰 수정 공통 패치 임시 통합 복제본: 23/23 통과.
- 전용 코드와 인증 웹 smoke: 22/22 통과.
- 전용 ESLint, 전용 `tsc --noEmit`: 통과.
- 통합 담당의 Qoo10 타입 수정 후 현재 통합본 `tsc --noEmit`: 통과.
- 리뷰 수정 공통 patch는 현재 통합본에서 4경로 `patch --dry-run` 통과.
- 제안 패치 적용 임시 통합 복제본 전체 `tsc --noEmit`: 통과.

## 통합 경계

- 정확한 공통 patch: `docs/cs-parallel/proposals/elevenst/elevenst-003-alimi-get-common.patch`
- 공통 patch 설명/해시: `docs/cs-parallel/proposals/elevenst/elevenst-003-alimi-get-common.md`
- 운영 읽기 RPC 제안: `docs/cs-parallel/proposals/elevenst/elevenst-004-read-state-rpc.md`
- 격리 실행 증거: `docs/cs-parallel/reports/elevenst/evidence-isolated-auth-web-20260908.json`

운영 RPC와 Alimi ingest migration은 통합 담당 소유다. 적용 전까지 전용 route는 운영 완료가 아니며, 실 Q&A 업무 코드 500도 여전히 해결되지 않았다.

## 미수행

- 커밋·푸시·배포 없음
- 운영 DB/migration 적용 없음
- 실고객 답변·긴급알리미 PUT 없음
- 상품·주문·배송·송장 상태 변경 없음
- OTP 우회·다른 판매자 계정 전환 없음
