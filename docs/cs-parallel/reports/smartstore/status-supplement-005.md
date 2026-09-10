# SmartStore CS 상태 보완 005

supplement 002·003·004는 각각 SHA-256 `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`, `9727f4da736aee56fa69da4d84aa34bb8dd7f660368678717afb5d5a41911ea4`, `fb72c1b60abcdee0a680c1fb735b14db35ff3d1e59bf025dcdfe9681fe2f84c6`로 동결했다. 이번 보완은 새 파일만 추가한다.

## 최종 리뷰 결과

- 003 order binding은 completion을 생성하지 않고 credential NULL/verified scope 및 malformed 주문 참조를 fail-closed하므로 이번 수정 대상이 아니다.
- 005 enqueue는 입력·credential·기존 run scope를 fail-closed하고 항상 접수와 완료를 분리한다.
- 004 checkpoint v1은 실제 run 존재·상태·credential mapping·동일 run 결속을 확인하지 않아 orphan scan, queued run, missing mapping, cross-run product/customer를 `complete=true`로 승격하는 결함이 있다.
- 한 kind만 reconciled, NULL `reconciled_at`/`unprocessed_count`, 불일치 scope는 v1에서도 완료되지 않는다.

## 새 proposal

- checkpoint v2는 동일한 succeeded exact-scope run 안의 product/customer 두 scan만 완료로 인정한다.
- route schema/RPC/advance rule을 v2로 함께 전환하는 별도 patch를 제공했다.
- frozen 005 route patch의 마지막 `}` 누락은 별도 syntax-repair patch로 분리했다. 이미 root에서 복구된 소스에는 syntax-repair를 다시 적용하지 않는다.
- 새 test는 frozen v1의 false completion을 실제 재현하고 v2가 모두 차단함을 PGlite에서 확인했다.
- 새 route 검증은 TypeScript diagnostics 0과 실제 exported GET 실행을 모두 요구한다.

## 판정

- checkpoint v1: 통합 금지. v2로 교체 필요.
- 상품문의·고객문의 핵심 2종: 실제 46/46 read-only 분모는 유지되지만, 운영 history resume는 v2 적용 전 완료 판정 불가.
- SmartStore CS 전체: 실답변 왕복과 TalkTalk·리뷰가 남아 미완료.
- mutation: 운영/provider/credential/고객답변/commerce 모두 0.

다음 통합 단계는 root의 사용자 선택 기간·eBay 변경·route 구문 복구를 보존한 채 007 SQL과 v2 route 세 필드만 반영하고, 운영과 분리된 DB에서 본 반례들을 재실행하는 것이다.
