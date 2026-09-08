# 11번가 CS 계약·제한 증거

- 기준 시각: 2026-09-08 KST
- 계정: 판매자 ID `couplit`, 판매자명 `커플릿`. Chrome 로그인 이메일은 판매자 ID가 아니다.
- 브라우저: 읽기 전용으로 확인한 CHANGHEE 프로필의 준비된 Seller Office 세션만 사용했다.
- 비밀, 원 IP, 고객 원문, 11톡 서명 URL은 기록하지 않았다.

## 상품 Q&A

- 공식 GET: `GET /rest/prodqnaservices/prodqnalist/{start}/{end}/{answerStatus}`
- 공식 상태: `00=전체`, `01=답변완료`, `02=미답변`
- 한 번의 조회 기간은 최대 7일이다.
- `brdInfoNo`는 답변 대상 게시물 ID, `brdInfoClfNo`는 상품 번호다.
- 답변 완료 행은 `answerYn=Y`뿐 아니라 답변 본문과 답변일도 있어야 한다. 날짜만 있는 값에는 임의 시각을 붙이지 않는다.
- 공식 가이드상 결과 코드 `500`은 비즈니스 오류다. 따라서 이번 0개 파싱은 빈 원장 증거가 아니다.
- 공식 가이드: <https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=41>

## 긴급알리미

- 공식 GET: `GET /rest/alimi/getalimilist/{start}/{end}/{status?}/{orderNo?}`
- 한 번의 조회 기간은 최대 30일이다.
- 상태는 `01=미확인`, `02=답변대기`, `03=답변완료`, `04=재답변요청`, `05=재답변완료`, `06=처리완료`다.
- `emerNtceClfNo1=10`은 긴급문의, `11`은 긴급알림이다. 같은 API에서 들어오더라도 별도 kind로 보존해야 한다.
- `emerTypeCd=01`은 답변요청, `02`는 공지다. 공지 확인과 문의 답변을 같은 mutation으로 합산하지 않는다.
- 공식 GET의 `result_code=0`은 명시적인 정상 빈 결과, `-1`은 비즈니스 오류다.
- 현재 PUT은 `PUT /rest/alimi/alimianswer`다. `100`은 공지 확인 접수, `200`은 답변 접수이며 둘 다 재조회 관측이 별도로 필요하다. 이전 내용순번별 API는 Deprecated다.
- 기간별 GET: <https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=58&apiSeq=1796&apiSpecType=1>
- 현재 PUT: <https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=58&apiSeq=6982&apiSpecType=1>

## 11톡/셀러톡

- Seller Office의 서명된 세션 브리지로만 현재 대화 화면에 진입했다.
- 화면 고지상 대화 내용과 대화방은 최대 3개월 보관 후 자동 삭제된다. 지속 보관은 별도 캡처가 필요하다.
- 공식 OPEN API 가이드에서 `11톡`, `셀러톡`을 각각 검색했지만 계약 결과가 없었다.
- 따라서 현재 자동 수신/답변 API로 표시하지 않는다. 검토된 브라우저 캡처만 수동 import 후보이며, 90일 이전은 복구 불가 범위가 생길 수 있다.

## 리뷰·댓글

- Seller Office 리뷰 관리에는 상품 번호, 리뷰 번호, 내용, 평가, 미디어, 작성일, 댓글 여부, 주문 번호 열과 Excel 다운로드가 있다.
- 2026-09-01~2026-09-08 검색은 0건이었다.
- 공식 OPEN API 가이드에서 `리뷰` 검색 결과가 없었다.
- 실제 리뷰 행이 없어 댓글 작성 UI·원격 반영을 검증하지 못했다. Excel은 실제 자료 수입 후보일 뿐 자동연동이나 댓글 API가 아니다.

## 현재 판정

- 활성 Key는 긴급알리미 30일 GET에서 정상 빈 결과 코드 `0`을 받았으므로 전면 무효 Key가 아니다.
- 같은 Key·실행 출구의 상품 Q&A는 모든 상태와 첫 30일 다섯 구간에서 비즈니스 오류 `500`이었다. 상품 Q&A 서비스 권한 또는 Key 서비스 연결을 API 관리 화면에서 별도 확인해야 한다.
- Seller Office의 Q&A 0건과 API 오류를 서로 상쇄해 “과거 전량 0건”으로 결론내리지 않는다.
