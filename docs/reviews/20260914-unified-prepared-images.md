# 상세페이지 이미지 선제작 통합

사용자 지시: 기존 별도 1차 이미지 제작을 없애고 상세 단계의 이미지를 먼저 만들어 상세페이지에 재사용한다.

## 구현
- 연출 이미지 8개(portrait, wide, overview, use, routine, scale, storage, context)를 준비 단계에 모았다. Mac은 간소화된 firstDraftScenes 옵션 없이 최종 상세 제작용 generateDistinctAsset와 같은 품질 검사를 사용한다.
- 상세 단계는 검증된 8장 바이트를 재사용한다. 나머지 대표/썸네일/라벨 등 8종은 원본 보존 가공이다. 기존 개별 재제작과 기존 상품 수정 기능은 유지한다.
- 사실 변경이나 재사용 증거 누락 시 상세 단계에서 자동 재생성하지 않고 준비 단계 확인을 요구한다. 본문 모델의 표현 변경 때문에 검토한 상품 사실과 장면 계획이 달라지지 않도록 고정한다.
- 생성 전 원본은 generatedImages URL을 null로 반환한다. 정보 분석 완료와 이미지 준비 완료를 구분한다.
- 전체 화면을 막던 오버레이를 제거하고 스크롤 중에도 보이는 진행 패널에 다음 상품 등록/뒤로 가기/진행상황/중지/삭제를 표시한다. 초기 복원 대기에도 이동 버튼을 표시한다.
- DB 함수는 새 8장과 기존 6장 작업을 구분한다. 구형 6장 결과를 신형 8장 완료로 표시하지 않는다.

## 검증
- 이미지/상세/화면 흐름 88개 통과, 요청 계보/복원/품질 계약 27개 통과. 모의 제공자 상세 테스트에서 연출 API 호출 0회, 재사용 8장 해시 동일, 최종 16종 저장을 확인했다.
- 운영 DB 트랜잭션 롤백 검사: 8장 단계별 저장(6장만으로 완료되지 않음) 및 구형 6장 완료 호환 통과. 테스트 레코드는 롤백했다.
- 모바일 브라우저 버튼 클릭과 스크롤 가시성 검사, TypeScript 통과.
- 새 나랑드사이다 이미지의 실제 생성 품질이나 판매채널 등록 성공을 이 검사로 주장하지 않는다.

## 배포
- 운영 코드 `151675b33e8c82182df537498660d3e04cab2af9`, Vercel `dpl_2YGKLiPQWKBtxiXfcsVthGsHwGjz` READY 및 운영 도메인 승격 완료. origin/couplit integration-aside에 푸시했다.
- 후보/운영 각각 작업 실행 없는 점검 6개 통과. Supabase 활성 런타임과 기존 8개 등록 경로의 SHA를 맞췄다. 계정·권한·승인 범위는 보존했다.
- 마이그레이션 `20260914024501_unified_prepared_studio_images` 적용. journal의 이름과 전체 SQL 원문 MD5 `3aee50b729e838d6e03b3336a920ce20`가 로컬 파일과 같다. Supabase security advisor MCP는 권한 거절로 실행하지 못했다. 함수의 기존 관리자/작업자/소유자 검사는 유지했다.
- 이전 방식으로 진행 중이던 나랑드사이다 `f2a23e7b-d55b-4d01-a9ca-ecbe85631cb8`은 중지했다. 입력·원본·조사 결과는 삭제하지 않았고 새 이미지 작업을 임의로 중복 접수하지 않았다.
- Mac AI PID 52663 재시작 후 변경된 5개 파일 바이트를 운영 커밋과 대조했다. 기존 gateway도 새 SHA로 전환해 ready/HTTP 200을 확인했다.
- Aside 기존 SellerPilot 탭을 새로고침하여 운영 화면의 8장 준비 안내 및 버튼을 확인했다. 뒤로 가기가 연결 화면으로 이동하고, 다음 상품 등록이 빈 입력 화면을 여는 것을 직접 확인했다. 실제 생성 중 스크롤/버튼 상태는 모바일 브라우저 자동 검사 근거이며, 새로운 실제 이미지 생성은 수행하지 않았다.

## Actual UI follow-up: six Narangd source photos

The first live Aside test (`c2ceb8cd-fbf1-46f4-99db-80d664a7b4ea`) failed before AI scene generation with `preflight_result_invalid`. Reproduced in the default preflight test: the six-color/three-position placeholder cycle made portrait/storage and wide/context byte-identical after expanding to eight roles. Extended the internal palette to eight; duplicate detection remains enforced and these placeholders remain hidden from the generated-image gallery.

The user then requested all six new Downloads photos. First-stage submission now includes every selected role/additional photo and binds pending retries to a digest of the full ordered selection. Corrected residual six-image labels. Server-research tests: 44 passed; UI submission/lifecycle tests: 16 passed; TypeScript passed. Deployment and actual generated result verification are pending for this follow-up.
