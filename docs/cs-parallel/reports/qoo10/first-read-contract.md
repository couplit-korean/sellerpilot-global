# Qoo10 CS 첫 실제 읽기와 종료 계약

- 관측 시각: 2026-09-08T10:03:32.388Z
- S0: `S0-20260908-decaba426812a3ba`
- 공급자: Qoo10 Japan (`qoo10.jp`, `api.qoo10.jp`)
- QSM 계정: seller `zrlawjdgns`, shop `Couplet Seoul`
- 운영 credential: active production v6, expiry `2027-08-20T14:59:59Z`, 저장된 `seller_id`와 QSM seller ID 비밀값 미출력 비교 `true`
- 고정 기간: `2026-08-09 00:00:00`~`2026-09-07 23:59:59`, `Asia/Tokyo`
- 실행: `scripts/cs-qoo10-provider-read-only.mjs`; Vault 평문과 고객 원문은 출력·저장하지 않음

## 범위별 수량과 종료 계약

| 소스/범위 | 상태·kind | 공급자 결과 | 원격 행 | ticket/message | page/cursor/total | 이 범위의 종료 판정 |
|---|---|---|---:|---:|---|---|
| `CSCenter.GetInquiryMessage` | S1 / MSG·HELP·ITEM 합집합 | `0 SUCCESS`, 배열 | 0 | 0/0 | 모두 미제공 | 같은 account·기간·상태의 성공 빈 배열이므로 이 창은 완료 |
| `CSCenter.GetInquiryMessage` | S2 / MSG·HELP·ITEM 합집합 | `0 SUCCESS`, 배열 | 0 | 0/0 | 모두 미제공 | 같은 account·기간·상태의 성공 빈 배열이므로 이 창은 완료 |
| `CSCenter.GetInquiryMessage` | S3 / MSG·HELP·ITEM 합집합 | `0 SUCCESS`, 배열 | 0 | 0/0 | 모두 미제공 | 같은 account·기간·상태의 성공 빈 배열이므로 이 창은 완료 |
| `ShippingBasic.GetClaimInfo_V3` | 요청일 기준 전체 상태 | `0 SUCCESS`, 배열 | 0 | 0/0 | 모두 미제공 | 같은 account·기간·조건의 성공 빈 배열이므로 이 창은 완료 |
| QSM Buyer inquiry | 최근 30일, 전체 상태/유형 | 검색 결과 없음 | 0 | 0/0 | UI 총계 0 | 웹 화면 대조 완료; QAPI 전체 이력 증명은 아님 |
| QSM Review | `2026-08-09`~`2026-09-08` | 검색 결과 없음 | 0 | 0/0 | 화면은 최대 30일, Excel은 행이 있을 때만 | 이 30일 UI 창만 빈 결과; 자동 이력 복구 미지원 |

하루 분할 대조로 `2026-09-07 00:00:00`~`23:59:59`를 같은 네 범위로 다시 읽었고 모두 `0 SUCCESS / 0행`이었다. 비어 있지 않은 창은 QAPI가 total·page·cursor와 공식 반환 상한을 제공하지 않으므로 자동 완료로 처리하지 않는다. 관찰 상한과 같은 행 수가 나오면 일→시간으로 재분할하고, 포화된 하루/시간은 미완료 gap으로 유지한다.

## 더 이른 범위와 ID 의미

`2010-01-01 00:00:00`~`2026-08-08 23:59:59` 문의를 S1/S2/S3로 실제 읽었고 모두 `0 SUCCESS / 0행`이었다. 이는 그 요청 범위의 공급자 응답일 뿐, 공식 최초 제공일이나 보존기간이 문서화됐다는 뜻은 아니다. 따라서 전체 과거 완료 분모에는 넣지 않는다.

공식 QAPI 응답 설명은 `QUESTION_NO`를 원 문의번호, `SEQ_NO`를 문의번호로 설명하고 답변 시 두 값과 `INQ_TYPE`을 함께 요구한다. 현재 계정에서 실제 문의 행과 긴 대화가 0건이므로 동일 `QUESTION_NO` 아래 여러 `SEQ_NO`의 실데이터 대조는 불가능했다. 현재 `qoo10:<type>:<question>:<sequence>` ticket ID는 변경하지 않았고, 실제 다중 메시지 표본이 생기기 전까지 변경 금지로 둔다.

## 공식 계약

- [QAPI 공식 가이드와 Method 목록](https://api.qoo10.jp/GMKT.INC.Front.QAPIService/Document/QAPIGuideIndex.aspx)
- [구 OpenAPI 종료 및 QAPI 전환 안내](https://api.qoo10.jp/GMKT.INC.Front.OpenApiService/APIList/default.aspx?intro=home)

공식 목록에서 `GetInquiryMessage`, `SetInquiryMessage`, `GetClaimInfo_V3`는 확인했지만 Review나 Buyer Chat 전용 QAPI method는 찾지 못했다. Review는 QSM의 30일 검색/Excel 경로만 확인했고 실제 행이 0이라 export 파일 형식도 아직 검증하지 못했다. 가상 parser는 만들지 않았다.
