# 이미지 압축 및 운영 DB 효율 검토 — 2026-09-13

## 결론과 적용 범위

이미지 생성 후 최종 압축의 누락 경로와 무손실 검증·취소 처리를 수정했다. 운영 DB에는 미해결 게이트웨이 조회용 작은 부분 인덱스를 적용하고 실제 실행 계획을 비교했다. 별도로 app/lib 759개 소스 파일의 RPC 호출 525곳을 분석하여 이름을 확정한 함수 329개를 운영 DB와 대조했다. **233개 존재, 96개 부재**다. 동적 호출 28곳은 이름을 확정하지 못했으므로 96개는 누락의 하한이며 전체 DB 계약 통과가 아니다.

대상은 Aside에서 확인한 공식 계정의 Supabase `sqaoqucxakebqkiygdxb`, main Production이다. 개발·진단 산출물은 `~/dev/sellerpilot-app`과 `/tmp`에서 작업했으며 기존 `output/pdf/`를 보존했다.

## 이미지: 실제 실행 경로와 수정

| 경로 | 실행 위치 | 이번 확인·구현 |
| --- | --- | --- |
| 1차 6장 기본 원본 가공 | Vercel, `generateServerProductResearchPreflightAssets` | 최종 합성 PNG에 빠져 있던 Sharp 압축 연결. 압축 이후 digest·서명 업로드·lineage를 계산하며 원본 사진은 변경하지 않음 |
| 1차 6장 AI 재생성 | Mac, first-draft lane → 공통 생성기 | 기존 로컬 압축 연결 확인. 이번 공통 검증·취소 수정 적용 대상 |
| 2차 이미지·상세페이지 자산 | Vercel server-product-studio / Mac product-ai-worker | 기존 최종 자산 압축 및 digest 계산 순서 확인. Vercel은 Sharp, Mac은 Sharp + OxiPNG/Zopfli |

- `caBX`(C2PA)·`iDOT`가 있는 PNG는 재인코딩하면 픽셀이 같아도 서명 해시/오프셋이 무효가 될 수 있다. 이 경우 전체 파일 바이트를 보존하고 변경된 후보를 거부한다. 기존에는 네이티브 단계만 건너뛰고 앞선 Sharp 단계가 바이트를 변경하는 결함을 재현했다.
- 원본은 한 번 디코딩해 후보 검증에 재사용하고 작은 후보부터 검사한다. 더 큰 후보나 원본보다 큰 파일을 채택하지 않는다. IHDR·비-IDAT 메타데이터·픽셀·알파를 대조하며 palette/색상 축소를 하지 않는다.
- APNG·16-bit 등 지원하지 않는 입력은 그대로 보존하며 불필요한 네이티브 실행을 생략한다.
- Sharp 처리 중 취소된 요청이 뒤늦게 네이티브 프로세스를 시작하던 문제를 고쳤다. 압축 후·실행 직전·결과 읽기/검증 뒤 취소를 확인한다. 네이티브 1~30,000ms 예산, 단일 실행 슬롯, 종료 타이머 정리, 출력 크기 선확인을 유지한다.
- 네이티브 실패·시간 초과·잘못된 출력이면 검증된 Sharp 결과를 사용한다. 구매자에게 보낼 상품·CS·배송 요청을 시험 목적으로 생성하지 않았다.

### 측정과 한계

같은 결정적 합성 RGBA 입력, Node 22.23.2, 각 3회 중앙값이다. 실제 상품 사진의 압축률이나 전체 생성 시간 보장이 아니다. peak RSS는 측정하지 않았다.

| 입력 | 입력 → 최종 bytes | 수정 전 → 후 중앙값 |
| --- | --- | --- |
| 1200×1500 gradient | 7,213,207 → 27,432 | 95 → 95ms |
| 960×960 texture | 3,693,379 → 3,239,711 | 188 → 175ms |

출력 크기·선택 인코더가 같으므로 이번 효율 수정으로 추가 화질 손실이나 결과 크기 증가가 없었다. 원본에 따라 무손실 압축 여지가 없으면 원본을 유지한다. 모델 이미지 품질·구도·상세페이지 디자인 자체를 압축 개선으로 평가하지 않는다.

## DB: 완료 이력 전체 조회 제거

운영 gateway 원장은 조회 시점 약 56,644건, 약 65MiB였다. 누적 seq_tup_read는 약 43.75억 건이며 이는 통계 누적치이지 이번 요청의 읽기량이 아니다. 기존 queued/running/lease/중복방지 인덱스는 존재했지만 `reconciliation_required` 확인을 위한 인덱스가 없었다.

`20260912200128_index_gateway_reconciliation_guard.sql`을 적용했다. 조건은 `status='reconciliation_required'`, 키는 `(credential_id, channel, environment, operation, id)`다. 작업 행·상태·claim 규칙·권한은 변경하지 않는다. lock timeout 1초, statement timeout 15초 및 database 자원 잠금을 사용했다. 원본 SQL과 migration journal은 같은 트랜잭션으로 기록했다.

- 원본 SHA-256: `4a8165c37a15cbdf9337f98b91ed3d480e9500523b7915aa911bf7a92be7d4c3`.
- 운영 journal version/name/원문 SHA가 일치한다. 인덱스 valid=true, ready=true, 16,384 bytes.
- 적용 후 blocking session 0, idle-in-transaction 0.
- 이전 CS migration 12건에 이번 성능 migration 1건이 추가됐다. CS 누락 전체 복구 건수로 합산하지 않는다.

동일한 Shopee production credential-refresh 미해결 조회를 `EXPLAIN (ANALYZE, BUFFERS)`로 전후 비교했다. 실제 claim RPC를 실행하거나 job을 수령하지 않았다.

| 항목 | 적용 전 | 적용 후 |
| --- | --- | --- |
| 경로 | gateway Seq Scan | 새 부분 인덱스 Index Scan |
| queue 검색 | 56,644건(3건 일치, 56,641건 제외) | 미해결 15건(3건 일치, 12건 제외) |
| root 실행 구간 종료값 | 27.121ms | 0.146ms |
| shared buffer hit | 5,415 | 25 |
| 결과 | 3건 | 동일 3건 |

이는 한 조회 표본이다. 전체 claim RPC의 p95·연속 운영 부하 개선을 측정한 값이 아니다. 계획 시간은 전 3.560ms, 후 3.911ms로 별도이며 위 실행 구간에 포함하지 않았다. 재현 SQL은 `scripts/diagnostics/sellerpilot-db-efficiency-readonly.sql`에 있다.

## 빠져 있던 DB 계약: 96개 확인

[전체 누락·호출 위치·마이그레이션 출처](20260913-runtime-rpc-inventory.json)를 남겼다. 정적 분석기는 `scripts/diagnostics/build-runtime-rpc-inventory.mjs`이며 imported const와 조건 분기를 분석하고 shadowing·동적 이름을 구분한다. SQL/docs 문자열 검색을 실행 호출 근거로 쓰지 않는다. 출력 SQL은 pg_proc 조회뿐이다.

| 영향 범위 | 확인된 예 | 필요한 후속 검증 |
| --- | --- | --- |
| 상품 등록·복구 | eBay/11번가 recovery, SmartStore 최종 전송·완료, Lazada r7, Qoo10 fulfilment, Temu 공식 원본 증거 | 승인·자격 증명·CREATE 단계·기존 함수 wrapper의 선행 migration과 실제 정의 해시 대조 |
| CS 공통 | import 시작/미리보기/확정/취소, 범위 상태, 복구 준비 상태 | 기존 계정·문의 원장 및 RLS/서비스 함수 계약 대조 |
| CS 채널 | SmartStore 이력/정확한 답변 재조회, Shopee 채팅/미디어, Lazada 보충 수집/후기, eBay 분쟁, 11번가 계정/진단, Qoo10 이력/답변 확인, Temu 이력 | 채널별 선행 원장·페이지/계정 결속·권한·중복 방지 및 실제 제공자 응답 대조 |

이름 존재 검사는 인자·overload·실행 권한·함수 본문 버전까지 증명하지 않는다. 동적 RPC forwarding 28곳도 별도 검토 대상이다. Qoo10 fence v2는 CREATE 정의가 아니라 `20260910033500`의 RENAME으로 만들어지는 함수임을 확인해 출처에 추가했다. 파일명 정렬은 안전한 운영 적용 순서가 아니다. 기존 미결속/진행 중 작업을 변경하거나 성공을 가정한 stub을 추가하지 않았다.

## 검증

- 이번 이미지·1차 preflight·인덱스·RPC 인벤토리 검사 **59/59 통과**, 실패/skip 0. `/tmp/sellerpilot-image-db-final-tests.log`.
- 실제 결함을 먼저 재현한 뒤 수정했다: 보호 출처 바이트 변경, Sharp 도중 취소, 지원하지 않는 포맷의 네이티브 호출, 기본 1차 이미지 압축 누락.
- default preflight 시험은 업로드되는 6장의 픽셀/알파·크기 감소·lineage SHA·원본 SHA 보존을 함께 확인한다.
- PGlite 인덱스 시험은 완료 이력 5만 건과 미해결 15건, 다계정/다채널 범위, 상태 분포·RLS/직접 접근 권한 불변을 확인한다. 실제 다중 세션 경합 시험은 아니다.
- `pnpm build:vercel` 종료 0. `/tmp/sellerpilot-image-db-build.log`.
- 전체 저장소의 과거 실패 83건을 모두 해소했다는 의미가 아니다. 운영 후보 배포/실행본 확인 결과는 아래에 후속 기록한다.
