# Lazada V3 로컬 런타임 통합

사용자가 idle 방치를 지적한 뒤 확인: Lazada 작업은 실제 idle였고, 통합 담당이 고정본 인수 뒤 통합을 바로 진행하지 않은 조율 공백이 있었다. 담당에 DB→인증 GET/웹 격리 검증을 배정해 active로 재개한 것을 확인했다.

## 적용

base delta + supplemental + V3 + V3 followup의 before/after hash chain을 합쳐 31개 파일을 통합했다. 원본/공통 소유권 검증을 수행했다. 이미 통합된 raw 재처리 source/test는 parser/1과parser/2 문자열 차이만 있음을 확인하고 parser2로 전진했다. 다섯 공통 runtime 파일의 정확 preimage 시험 통과 후 V3 patch를 적용했다.

SQL은 proposal 경로에만 있다. 정식 migration 파일화 및 전체 schema preimage 검토는 남았다. V3 RPC가 없거나 readiness가 false면 runtime은 fail-closed다. 운영에 배포하지 않았다.

## 직접 검증

처음 219개 중9개 실패는V2 fixture/readiness 가정이었고 V3로전환했다. 추가공통묶음에서 오래된SmartStore orderReferenceState 기대 및LazadaV2mock을수정했다. readiness 미확인/false/RPC오류는 저장0, readiness true라도V2receipt는성공불가 반례추가.

최종Lazada TS/V3 DB·patch/기존raw및reply DB/common inquiry-sync/serverless CS:309/309,skip0,exit0. 로그 /tmp/cs-lazada-v3-final.tap. 전체tsc --noEmit --incremental false exit0(최종common fixture수정전); runtime코드는그후변경없음.

## 런타임 최종 hash

- lib/channels/lazada-im-webhook.ts: `45e1f2bb3cd8b34ef87584a112cee00399ec3569ea06c9781edf52bf2f939767`
- app/api/webhooks/lazada-im/route.ts: `e8409ab4929c88da3d46a8fa41af108f1cdf3aa5bb0d2fccac16b9c41c4e851f`
- app/api/channel-gateway/worker/complete/route.ts: `9e1ba34b77788d1ea68ac2489e09dda322fea4d9f8400cbd8c85e757e7831781`
- lib/channels/serverless-gateway.ts: `aa8703fff6a2441558f4bb926d7642dab4cbd21fcf8a73b90bcd98882e9ae852`
- lib/channels/lazada-raw-reprocess.ts: `4445237b37f85d5a786ffbaed2e55269fb1db1514375cdd0602ab287f62b69e0`

## 남은 일

정식migration/실제전체schema검증,DB→인증웹 후속,provider-certified binding/공개callback/실제수집·답변관측은미완료. 상품후기권한과역주문CS범위도전체완료로숨기지않는다. 커밋/푸시/배포/운영DB/credential/실답변변경없음.
