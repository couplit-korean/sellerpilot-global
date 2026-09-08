# 11번가 CS 보완 07 상태

- 보완 델타 ID: `elevenst-supplement-07-20260909`
- S0: `S0-20260908-decaba426812a3ba`
- 동결 선행본: `supplement-06-delta.json` SHA-256 `2d2e66eeadf746aea6e07807ee4e44fb56c465abe9127313a0f78d4ddf9c4e0a`
- `supplement-06`은 수정하지 않았고, 이 델타가 90일 환산 표현만 교정한다.
- 운영 변경: 없음.

## 교정 결론

1. Seller Office의 실제 고지는 `최대 3개월`이다. 보완 06의 `retentionDays=90`과 UI `최대 90일`은 월을 일로 부정확하게 환산하므로 사용하지 않는다.
2. SellerTalk capability와 limited-access 계약을 `{maximum: 3, unit: "month", exactDays: null}`로 교정했다. 숫자 일수 필드는 제거했다.
3. 인증 read-state는 v3, limited-access projection은 v2로 올려 이전 90일 형태와 조용히 호환되는 것을 막았다.
4. UI는 `최대 3개월 · 정확한 일수 미확정`으로 표시한다. 이 값을 자동 history cutoff나 과거 전체 완료 판정에 사용할 수 없다.
5. 실제 코드 사용처를 대조한 결과 `elevenstCsCapabilities.seller_talk` 보존값을 소비하는 자동 이력 코드가 없고, 90일 표현은 동결 보고서와 동결 제안서에만 남는다.

## 검증 결과

- Node 22 교정 모델·DB·인증 웹: 19/19 통과.
- 최신 중앙 통합본에 전용 교정만 올린 임시 복제본 전체 `cs-elevenst` 직렬 시험: 42/42 통과.
- 실제 Next dev 포트 3214 인증 스모크: 401/401/200, contract v3, retention month=3/exactDays=null, DB read 1, provider/prod DB write 0.
- 전용 폴더와 임시 통합본 전체 `tsc --noEmit`, 변경 경로 ESLint 통과.
- 시험 종료 뒤 포트 3214 listen 0.

## 변경하지 않은 상태

- Product Q&A 실제 결과는 HTTP 200 뒤 업무 `500`이며 완료가 아니다.
- 긴급알리미 실제 30일 GET만 정상 코드 `0`, 0건이다.
- SellerTalk/리뷰의 공식 자동 API 계약, 과거 전체, DB 수입, 답변·댓글 readback은 여전히 없다.
- provider/customer/product/order/shipping mutation, 운영 DB, 배포, commit, push는 모두 0건이다.

## 통합 순서

1. 최신 중앙에서 supplement-06의 after hash가 일치하는지 확인한다.
2. `supplement-07-delta.json`의 10개 코드·시험 파일과 3개 새 증거 문서를 함께 반영한다.
3. 전용 직렬 시험과 포트 3214 인증 스모크를 다시 실행한다.

동결 supplement-06의 문구는 역사 증거로 남기되, 현재 판정은 이 보완 07을 따른다.
