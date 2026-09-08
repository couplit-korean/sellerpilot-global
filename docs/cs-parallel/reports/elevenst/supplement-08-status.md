# 11번가 CS 보완 08 상태

- 보완 델타 ID: `elevenst-supplement-08-20260909`
- S0: `S0-20260908-decaba426812a3ba`
- 동결 선행본: `supplement-07-delta.json` SHA-256 `06f4200f0be61fbb9ed5b9a89d4fc03eeed30b6e076266c9fa04d31129bbc436`
- `supplement-07`은 수정하지 않았다.
- 운영 변경: 없음.

## 방어 교정

1. Product Q&A 분류기는 HTTP 200의 `resultCode=500`을 `accepted` 값보다 먼저 검사한다.
2. 따라서 모순 입력인 `accepted=true`, `resultCode=500`, `providerRows=0`도 `business_error`이며, 원격 0건 성공으로 바뀌지 않는다.
3. read-model의 중복 500 분기를 제거하고 공통 계약 분류기 한 곳을 사용한다. 회귀시험이 실제 source-of-truth를 직접 통과한다.
4. 현재 실제 Q&A 결과 자체는 바뀌지 않았다. HTTP 200 뒤 업무 `500`이므로 최신/과거 건수와 답변 상태는 미확인이다.

## 검증 결과

- Node 22 전용 계약·read-model: 10/10 통과.
- 최신 중앙 통합본 임시 복제본 전체 `cs-elevenst` 직렬 시험: 42/42 통과.
- 최초 병렬 실행은 동시에 기동한 Next 스모크의 포트 3214 충돌로 41/42였고, 해당 단독 시험 1/1 및 직렬 전체 42/42로 재확인했다.
- 전용 폴더와 임시 통합본 전체 `tsc --noEmit`, 변경 경로 ESLint 통과.
- 시험 종료 뒤 포트 3214 listen 0.

## 변경하지 않은 상태

- Product Q&A 실제 읽기·30일 다섯 구간은 업무 `500`으로 완료되지 않았다.
- 긴급알리미 실제 30일 GET만 코드 `0`, 0건으로 확인됐다.
- SellerTalk은 현재 화면 0개 대화방·친구 0명, 리뷰는 최근 7일 화면 0건만 관측했다. API/과거 전체/DB 수입/답변·댓글 readback 완료가 아니다.
- provider/customer/product/order/shipping mutation, 운영 DB, 배포, commit, push는 모두 0건이다.

## 통합 순서

1. 최신 중앙에서 supplement-07 델타 SHA와 세 수정 파일의 before hash를 확인한다.
2. `supplement-08-delta.json`의 세 코드·시험 파일과 세 새 증거 문서를 함께 반영한다.
3. 전체 `cs-elevenst` 시험은 포트 충돌을 피하도록 직렬 실행한다.
