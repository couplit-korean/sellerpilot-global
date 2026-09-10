# SmartStore history-resume-v5 route 실행·UI 연결 제안 006

- S0: `S0-20260908-decaba426812a3ba`
- 선행 동결본: supplement 002 `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`, supplement 003 `9727f4da736aee56fa69da4d84aa34bb8dd7f660368678717afb5d5a41911ea4`
- 상태: 공용 소스에 미적용한 proposal

## 현재 UI 추적

현재 `app/cs/history-window.tsx:20`의 스마트스토어 버튼은 `onBackfill("smartstore", endDate)`를 호출한다. `app/page.tsx:6687`이 이를 `syncOrders(false, 30, channel, endDate)`에 연결하고, `app/page.tsx:6125`가 `/api/operations/sync`에 POST한다. 따라서 SQL v5와 새 `/api/admin/cs/channels/smartstore/history-resume-v5` route가 제안돼 있어도 현재 UI는 구형 v4 30일 endpoint를 계속 사용한다.

## 연결 패치

`smartstore-006-ui-history-resume-v5.patch`는 다음만 바꾼다.

1. SmartStore 버튼은 인증된 fetch로 `POST /api/admin/cs/channels/smartstore/history-resume-v5`를 호출한다.
2. 요청 범위는 실제 read-only 분모의 공통 하한 `2022-11-30`부터 사용자가 고른 종료일까지다. route checkpoint가 아직 끝나지 않은 1~30일 한 창을 선택한다.
3. `202 Accepted`와 `acceptedNotCompleted=true`를 화면에서 명시적으로 “접수됐지만 완료 아님”으로 표시한다.
4. checkpoint가 complete여서 `200`과 `historyBackfill:null`을 반환한 경우에만 상품문의·고객문의 체크포인트 완료 문구를 표시한다.
5. SmartStore를 legacy `onBackfill` 타입과 호출부에서 제거한다. 쿠팡과 11번가 Q&A의 기존 30일 동작은 유지한다.
6. 공용 `app/cs/history-window.tsx`, `app/page.tsx`는 직접 수정하지 않는다.

## 적용 순서

통합 담당자가 공용 변경 충돌을 정리한 뒤 아래 순서로 적용한다.

```sh
git apply \
  docs/cs-parallel/proposals/smartstore/smartstore-003-004-common-integration.patch \
  docs/cs-parallel/proposals/smartstore/smartstore-005-common-integration.patch \
  docs/cs-parallel/proposals/smartstore/smartstore-006-ui-history-resume-v5.patch
```

v5 SQL migration draft를 운영 DB에 검토·적용하지 않은 상태에서 route/UI만 배포하면 RPC가 없어 실패한다. 이 제안은 배포·migration·provider 작업을 실행하지 않는다.

## 실행 검증 범위

`tests/cs-smartstore-history-resume-v5-route.test.ts`는 로컬 공유 객체를 쓰는 `--shared --no-checkout` 임시 격리 clone을 만들고 005 route patch를 실제 `git apply`한다. 현재 UI preimage 두 파일만 같은 clone에 넣은 뒤 006 UI patch도 실제 적용한다.

패치에서 생성된 route TypeScript를 CommonJS로 변환해 실제 내보낸 `GET`·`POST`를 호출했다. anonymous, expired, non-admin, 잘못된 날짜, 복수 활성 credential, 완료 checkpoint, 정확한 1일 enqueue, enqueue 실패를 포함한다. UI 패치에서는 v5 URL·공통 하한·legacy SmartStore 호출 제거·page의 인증 fetch 전달과 TSX 구문을 확인한다.

인증 결과는 `authenticateAdminRequest` 호출 경로에 주입한 자동화 fixture다. 운영 비로그인·만료 세션·관리자 권한의 실제 브라우저/서버 인증 증거가 아니며 그렇게 승격하지 않는다.

## 완료로 해석하면 안 되는 것

- route 자동화 `200/202/401/403/409`는 운영 배포 또는 운영 DB 적용 증거가 아니다.
- `202 acceptedNotCompleted`는 product/customer 두 job 접수이며 provider GET, 원장 반영, 웹 표시 또는 전체 이력 완료가 아니다.
- 46/46 실제 과거 GET이 모두 0건이므로 신규 수신·답변 신규/수정·외부 선답변·새 문의 경쟁의 실표본 왕복은 여전히 없다.
- TalkTalk와 리뷰 adapter/history/reply는 계속 미연결이다.
