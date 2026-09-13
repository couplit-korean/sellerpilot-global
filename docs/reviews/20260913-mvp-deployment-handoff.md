# 상품 등록·CS MVP 배포 인도 — 2026-09-13

## 인도 상태

- 운영 코드: `e6813f19652ee20d65e5818794daf2d13726a707`.
- Production: https://sellerpilot-global.vercel.app . Vercel deployment `dpl_F8PZce7zbve4KauEQq4LZNoQF5uj`.
- Supabase 프로젝트 `sqaoqucxakebqkiygdxb` 활성 런타임과 게시 승인 SHA가 운영 코드와 일치한다. `effectiveOpen=true`, `publicationAdaptersReady=8`, `runtimeReleaseMatches=true`, 당시 등록 변경 실행 중 0건.
- 기존 Mac gateway도 같은 SHA, `ready=true`, `activeJobs=0`, `lastGatewayStatus=200`을 확인했다. 실행 중 작업이 없는 것을 확인한 뒤 정상 종료/재시작했다.
- origin/couplit의 integration-aside에 코드 푸시 완료. 후속 인도 문서 커밋은 코드 배포 SHA와 구별하며 문서만으로 다시 배포하지 않는다.

## 이번에 수정·반영한 구체적인 차단점

1. DB는 8개 채널 CREATE를 지원하지만 TypeScript의 로컬 수령 허용 목록은 2개뿐이었다. 누락된 6개 CREATE를 추가하여 기존 provider 처리 코드로 연결했다. 가격 변경·답변·배송 작업의 권한 목록을 확장하지 않았다.
2. Lazada는 서버 코드의 로컬 egress 정책 대상이지만 DB CHECK에는 빠져 있었다. `20260913122015_lazada_local_executor_egress_policy.sql` 한 개를 적용했다. 기존 5개 채널 설정·RLS·권한은 보존했고 Lazada의 cloud 정책을 false로 넣어 기존 Mac 실행을 선택할 수 있게 했다.
3. 기존 8개 CREATE 경로가 과거 배포와 교체 전 credential을 참조했다. 현재 버전과 같은 판매자의 활성 credential로 갱신했다. 발급 관리자 연속성과 판매자 키를 검증하고, Temu의 동일 credential 키 보정은 이미 승인된 같은 계정 CS 경로로 대조했다. 소유자·승인자·만료일·작업 종류·작업자·IP 등 나머지 필드는 동일함을 트랜잭션 안에서 검사했다. 기존 작업/attempt를 재작성하거나 전송하지 않았다.

Lazada migration journal의 version/name/원문 SHA-256 `1a411f473328aca1ec00a97f4cb2f11f7147c57f9a7c13cd8dee097c3e878c5b` 일치 확인.

## 실행 경로 확인

| 채널 | CREATE 경로 버전 갱신 | 현재 등록/CS 수집 경로 | 확인 한계 |
| --- | --- | --- | --- |
| 쿠팡 | 반영 | 기존 Vercel | 원격 등록/답변은 사용자 확인 |
| 스마트스토어 | 반영 | 기존 Vercel | 원격 등록/답변은 사용자 확인 |
| eBay | 반영 | 기존 Vercel | 시스템 메시지는 고객 대화가 아님 |
| Qoo10 | 반영 | 기존 Vercel | 일반 문의와 Buyer Chat은 별개 |
| 11번가 | 반영 | 기존 Mac | Q&A 범위, 셀러톡 별개 |
| Lazada | 반영 | 기존 Mac | MY 기존 연결, 추가 5개국 권한은 미완료 |
| Shopee | 반영 | 기존 Mac | 경로 준비와 별개로 API 토큰 문제 남음 |
| Temu | 반영 | 기존 Mac | 일반 구매자 채팅 수신/전송 미연동 |

등록 경로 8개가 같은 배포를 참조하고 승인 기간을 유지한다. Mac 대상 4개는 `local_channel_executor_route_is_current=true`를 DB 함수로 확인했다. 다른 4개의 false는 현재 Vercel 정책을 유지한 결과다. CS 수집 경로도 현재 SHA와 Mac 대상 4개 준비를 별도 조회했다. 이는 실제 provider 호출/상품 등록/고객 답변 성공 증거가 아니다. CREATE 경로 변경을 CS 답변 승인으로 사용하지 않는다.

## 검증

- 변경 집중 검사 5/5 및 provider CREATE 처리 행렬 1/1 통과.
- 새 Lazada 정책 DB 회귀 1/1 통과: 이전 제약 재현, Lazada 추가, 기존 5개 행 보존, 미등록 채널 거절, RLS/ACL 보존, 잘못된 선행 상태 거절.
- 최종 Vercel remote production build의 컴파일·타입 검사·127페이지 생성 통과.
- 배포 전 무작업 점검: 현재 release, claimed=0, processed=0, executed=false. 운영 화면에서 무작업 점검 6개 통과 및 Supabase 일정 재시작 확인.
- 넓힌 관련 검사에는 기존 실패가 남는다: 경계 검사 45/46(HEAD에 없는 elevenst credential-save 테스트 import 1개), 11번가 집계 52/60(기존 문자열 추출 fixture 불일치 8개). 전체 테스트 통과로 표시하지 않는다. 이번 변경을 이유로 기존 테스트 전체를 재작성하지 않았다.

## 남은 제한 및 사용자 확인

[Shopee 판매자센터 로그인]과 [API 토큰 유효성]은 서로 다르다. 기존 API 토큰 오류는 해결 완료가 아니며 새 로그인/OAuth를 반복하지 않았다. Temu 공식 GLOBAL 문서에서 일반 고객 채팅 계약을 확보하지 못했으므로 존재하지 않는 답변 API를 만들어 넣지 않았다. Lazada 추가 5개국 연결 코드는 배포했지만 실제 국가 권한 승인은 완료하지 않았다.

실제 상품 등록·고객 답변은 사용자 담당이다. [확인 순서](../MVP-사용자-확인순서.md)의 두 흐름만 확인한다. 주문/배송, 과거 실패 일괄 복구, 모든 국가 자동화는 이번 인도 범위에서 제외한다. 이 기록은 전 채널 실작동 완료 선언이 아니다.
