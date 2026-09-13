# 2026-09-13 eBay 승인 및 Lazada IM 최초 연결 복구

## 실제 확인

- eBay 새 승인 작업 `26fbc20b-8a0f-4c1e-8e6b-0797a1509d9f`는 04:44:22 UTC에 succeeded 및 completion receipt/최종 계정 저장까지 완료됐다. 동일 판매자의 활성 credential v204에 commerce.message scope가 저장됐고 과거 불확실한 승인 작업은 새 승인 근거로 superseded/cancelled 처리됐다. 04:49 UTC Commerce Message GET은 HTTP200, total21이었다. 전체 대화의 원장 수집 완료나 답변 발송 증거는 아직 아니다.
- Lazada commerce `/seller/get`은 MY/PH/SG/TH/VN 5개 국가의 저장된 seller ID와 일치했다. MY IM session GET은 code0이며 나머지 4개 국가의 IM은 IllegalAccessToken이다. 상품용 앱 137451의 국가 연결을 채팅용 앱 137571의 권한으로 간주하지 않는다.
- Temu 실제 after-sales 읽기는 HTTP200/success/total0/pageNumber0/data[]였다. 빈 첫 페이지를 잘못 거부하던 조건만 수정했고 후속 페이지·모순된 total·문자열0은 계속 거부한다.

## 수정과 DB 검증

Lazada 최초 bootstrap은 기존 capability binding을 요구하고, binding은 수집 완료 뒤에만 만들어져 시작할 수 없었다. 명시적인 IM 진단에서 채팅 토큰 갱신 응답의 국가·판매자를 상품 계정과 대조하고, rotating token은 먼저 Vault recovery에 저장한다. 동일 판매자 검증 뒤 활성 준비, 실제 IM 읽기, 정상 작업 완료 receipt 순서로 나라별 읽기 binding을 만든다. diagnostic의 성공은 문의 수집 완료가 아니다. 고객 답변 권한을 이 진단으로 생성하지 않는다.

CS binding fingerprint는 실제 IM 앱·토큰으로 계산하며, 전용 국가 인자를 실제 transport에서도 사용한다. 공유 Temu 검증 wrapper는 그대로 이어 호출한다. SQL migration `20260913060000`은 현재 함수 원문 md5를 검사한 뒤 forward로 적용했고 원문 SHA256은 `e9b72b14fa3ee63d8c1856c1d8d50f83ef892ac7fc9544f389c299b45fd2dc1a`다. 실제 DB rollback 시험에서 첫 binding/readiness, 타국 차단, 타판매자 차단, 위조 token proof 차단을 확인했다. 시험은 전부 rollback했고 테스트 계정·작업·Vault row를 운영에 남기지 않았다.

44개 집중 검사, 타입 검사, Next production build 통과. 실행 코드 764개 파일/663 RPC 호출/해결된 이름 380개를 운영과 대조해 누락0이다. 동적 인자 38곳은 별도이며 실제 전체 기능 성공을 의미하지 않는다.

## 배포 및 후속

eBay a5c7147 웹·Supabase 일정은 운영 중이다. 이 보고서의 Lazada/Temu 코드는 커밋과 배포 준비 중이며 실제 MY bootstrap→raw inbox→CS 투영을 후속 확인한다. Mac runtime도 후속 배포 SHA로 맞춘다. PH/SG/TH/VN IM 신규 권한, Shopee 잔여 수집 오류, 전체 채널 상품 등록/답변/배송 실제 readback은 별도 검증이 남는다. 실제 고객 답변이나 배송 변경을 이 검사의 목적으로 전송하지 않았다.
