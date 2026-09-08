# Temu 채널 작업 지침

2026-09-09 로컬 구조 정리 기준. 이 문서는 코드 연결 위치와 검증 순서를 정의하며 운영 연결 성공 증명은 아니다.

## 소유 파일과 진입점

- 상품 등록/수정/가격/재고: `lib/product-registration/channels/temu.ts`
- CS 실행 진입점: `lib/cs/channels/temu/adapter.ts`
- 기존 CS 세부 구현: `lib/channels/temu-inquiries.ts` 및 같은 채널 이름의 history/claim 모듈, `lib/channels/cs/temu/`, `lib/cs/channels/temu/` 아래 실제 존재하는 기능 파일을 따른다.
- 주문/배송: `lib/shipping/channels/temu.ts`
- 채널 키는 `temu` 하나로 고정한다. 실행 진입점이 다른 채널 입력을 받으면 인증/API 호출 전에 거부한다.

## 연결 입력과 구체적인 확인

지역 endpoint·app/판매자 토큰 참조·mall 식별·물류/포장 정보. 실제 필요한 필드는 각 실행기의 인자 검증·채널 계약·자격 관리 화면을 기준으로 확인한다. 비밀값은 기존 자격 저장소로만 전달하며 문서/코드/테스트 fixture에 복사하지 않는다. 로그인 성공과 API 권한/운영 연결 성공은 각각 확인한다.

after-sales parent/detail·초 단위 기간·재시도 커서를 보존한다. 공개 Buyer Chat/답변 API 지원을 추정하지 않는다.

## 구현 순서

1. 원하는 기능을 상품·CS·배송 중 하나로 선택하고 위 소유 파일에서 시작한다. 다른 영역/채널 실행기를 import하지 않는다.
2. provider payload 변환, 필수 인자, 계정/Shop 결속, pagination, 오류/재시도 처리를 해당 채널 파일에 구현한다. 공통 운송·인증 변경이 필요하면 범용 계약으로만 추가한다.
3. 각 영역의 `channel-adapters.ts`에 이미 연결된 `temu` 항목을 유지한다. 기존 API→영역 guard→registry→해당 실행기→완료 처리의 흐름을 따른다.
4. 과거 CS는 기간/페이지/표면별 수집→원장/중복제거→owner 권한 조회→history API→CS 화면까지 확인한다. 부분 성공은 전체 완료로 승격하지 않는다.
5. 이후 자동 수집은 첫 실행, 다음 커서, 토큰 만료, rate limit, 동일 작업 재시도, 중간 종료 후 재개, 계정 변경/삭제, 중복 방지까지 검증한다.
6. 상품은 등록/수정 요청과 공식 재조회 값·원격 ID·구매자 표시를 확인하고, 배송은 주문/패키지/택배사/송장 결속과 공식 배송 상태 재조회를 확인한다. 실제 변경은 그 시점의 사용자 승인 범위 안에서 진행한다.

## 로컬 통과 기준

```sh
npm run check:domain-boundaries
npm run check:channel-boundaries
npm run test:domain-isolation
npm run test:channel-isolation
node node_modules/typescript/bin/tsc --noEmit
npm run build:vercel
```

`build:vercel`은 로컬 빌드이며 배포 명령이 아니다. 추가로 변경한 기능의 채널 테스트와 실제 API/완료 처리 계약 테스트를 실행한다. DB 변경은 새 고유 migration 번호를 만들고 격리 DB에서 권한/기존 행/재실행을 확인한다.

## 완료 기록

기능별로 코드 검증, 로컬 DB/API 검증, 운영 인증/권한, 과거 수집 범위, 자동 증분 수집, 승인된 변경과 원격 readback을 각각 기록한다. 미지원 기능/외부 권한 차단은 원인과 마지막 증거를 남긴다. 테스트 개수나 로그인 상태로 운영 100%를 계산하지 않는다. 결과는 이 문서와 `docs/현재상태.md`에 반영한다.

## 2026-09-09 상품 등록 재검증

[세 채널 공식 계약 대조와 현재 운영 상태](three-channel-product-verification-20260909.md)를 따른다. 해당 채널의 필수값 검증은 `lib/channels/temu-create-preflight.ts`와 상품 전용 실행기에 연결돼 있다. 고유 로컬 회귀 299/299와 실제 신규 등록 완료 0/3은 다른 상태다. 운영 인증·상품 승인·공식 재조회 조건이 충족돼야 실제 완료 처리한다.
