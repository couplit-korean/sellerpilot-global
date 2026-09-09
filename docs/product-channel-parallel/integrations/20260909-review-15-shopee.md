# Shopee 006 r1 → r2 → r3 중앙 통합

2026-09-09 20:47 자동 점검에서 보고 스냅샷을 수집하여 새 r3를 발견했고, 담당 채팅 도착 전에 읽었다.

중앙 파일 12개를 별도 임시 디렉터리로 복사하고 세 frozen patch의 SHA-256을 확인한 뒤 각각 git apply --check와 apply를 순서대로 실행했다. 최종 해시는 담당 r3 및 r2의 유지 파일 해시와 모두 일치했다. 중앙 before가 변하지 않았음을 다시 확인한 후 12개 파일을 반영했다. 전체 before/after는 `.local/product-channel-inbox/review15-shopee-preapply.json`에 보존했다.

수정 내용: 선택한 SG 숍의 client→exact GET/typed POST→receipt 결속, Lazada v1 유지, 실제 gateway 결과 검사, 국가 선택 응답 순서 보호, 캐시 저장 시점 credential version 및 토큰 유효기간 검사.

중앙 선택 회귀 37/37 통과: category selection coordinator, mobile request resilience, Shopee lineage helper 및 실제 migration PGlite 테스트. 전체 non-incremental TypeScript와 변경 10개 파일 ESLint 통과. 업무·채널 경계 검사에서 missing 및 cross-channel dependency 없음. 전체 로컬 npm run build:vercel도 종료 코드0으로 통과했다. 로그는 `.local/product-channel-inbox/review15-integrated-build.log`다.

이 결과는 로컬 코드 통합이다. 새 SQL 파일을 운영 DB에 적용하지 않았다. 운영 token 만료, fresh discovery와 공식 필수 입력·승인 이미지·SGD 확정 및 신규 CREATE/readback은 계속 미완료다. 신규 실적19/48단계와0/8은 변하지 않았다.

SmartStore 신규등록003은 미열거 import 자동 성공 Proxy 제거를 구체적으로 배정했다. 별도 기존상품 C03 r3는 아직 중앙 검토 전이고 Qoo10 C02 scratch도 별도 계보다. 기존 복구 코드를 신규등록 성공으로 계산하지 않는다.
