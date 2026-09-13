# 2026-09-13 eBay 저장 계약 및 승인된 로컬 CS 일정 복구

## 현재 검증

eBay Commerce Message 신규 동의는 동일 판매자로 완료됐고 활성 credential v204 및 실제 API HTTP200을 확인했다. 발견된 대화21건은 FROM_EBAY 시스템 알림이며 구매자 문의21건이 아니다. 현재 구매자 대화 조회 작업 ffee819f-a8b9-42ce-b749-490bf42d48d6는 정상 completion receipt를 저장했다. 시스템 알림 전체 페이지 수집은 새 코드 배포 후 확인한다.

실제 시스템 알림 목록에는 referenceId/latestMessage가 없고 상세 HTML은 26,085자였다. transport, 관리자 API, 클라이언트 schema와 화면을 수정해 생략된 목록 필드를 null로 보존하고 상세 조회를 안내한다. 긴 본문은 eBay 시스템 역할에만 200,000자까지 허용하며 DB에서는 600,000바이트 상한도 적용한다. 구매자/판매자 20,000자 제한은 유지한다. HTML은 원문 문자열로 저장/표시하며 실행하지 않는다.

운영 함수 이름은 있었지만 eBay 대화 전용 ingest/reply 분기가 빠져 있었다. migration 20260913064000은 실제 함수/constraint preimage를 검사하고 현재 함수를 보존한 뒤 두 eBay 분기만 복구한다. 다른 채널은 현재 wrapper로 계속 위임한다. 실제 DB rollback에서 시스템 원문 저장·중복 제거, 구매자 크기 제한, 시스템 답변 차단, 동일 구매자 답변 요청의 동일 job 반환을 확인한 뒤 forward 적용했다. 합성 답변 요청은 전부 rollback했고 실제 고객에게 전송하지 않았다.

Vercel 주기 일정에서 승인된 Mac 경로를 누락한 결함도 수정했다. 새 service-only RPC는 현재 릴리스·동일 소유자/판매자·활성 gateway token·만료되지 않은 inquiries.list 승인 경로만 반환한다. 운영 DB에서 elevenst/lazada/temu를 확인했고, 비활성 Temu 경로는 rollback 시험에서 제외됐다. 이 목록은 enqueue에만 사용하며 Vercel 실행 IP 정책을 넓히지 않는다. migration 20260913063000 적용 완료.

Lazada IM 진단은 서버리스와 실제 Mac processor 모두 같은 토큰 회복/국가·판매자 검증 함수를 사용하도록 연결했다. 첫 MY IM 결속은 새 Mac 배포 후 정상 diagnostic receipt로 생성한다. 상품용 앱의 MY/PH/SG/TH/VN seller 조회는 일치했으나 IM은 MY만 읽기 가능, 다른4국은 IllegalAccessToken이었다. 미확인 권한을 생성하지 않는다.

## 증거와 배포 경계

- 이번 복구 wave에서 forward migration24개 적용. 이 숫자는 과거 전체 migration 수가 아니다.
- 최신 실행 코드764개 파일, RPC664호출, 해결된 이름381개를 운영과 비교해 부재0. 동적38곳은 37개 내부 이름 전달 adapter와 1개 유한 Shopee6-action 분기로 분류했고 여섯 이름도 대조했다. 이름 존재는 인자/권한/함수 본문 최신성 또는 실제 채널 성공 증거가 아니다.
- 관련 검사113개와 추가 관리자 API/클라이언트 경계21개 통과(중복 포함), 타입 검사 통과. 전체 저장소 검사 통과 주장은 아니다.
- 이 문서 작성 시 운영 웹/Mac은81286d5이며 새 코드의 candidate build, 승격, 운영 일정 활성화, Mac 동기화와 실제 수집 검증이 다음 단계다. 이전 실패 job을 성공으로 재작성하지 않는다.
- 실제 신규 상품 등록·고객 답변 발송·배송 변경의 채널별 종단 검증은 아직 완료되지 않았다.
