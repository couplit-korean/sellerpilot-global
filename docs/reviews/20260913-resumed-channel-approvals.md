> 2026-09-13 18:32 KST 정정: 아래는 17:20 당시 기록이다. 사용자는 기존 Shopee 로그인 탭을 사용하고 새 로그인 시도를 하지 말라고 명시했다. 아래 OTP·새 exact 세션 실행 순서를 재개하지 않는다. 기존 로그인 확인, DB 저장/재시도 결함의 적용 결과와 잔여 범위는 [최신 후속](20260913-shopee-existing-session-recovery.md)을 따른다.

# 준비된 로그인 세션·등록 승인·국가별 DB 권한 후속 검토

2026-09-13 17:20 KST. 사용자가 준비한 Aside 세션과 남은 승인에 대한 명시적 권한으로 진행했다. 정규 소스는 `/Users/kimchangheemac/dev/sellerpilot-app` 하나다. [이번 운영 증거](20260913-resumed-channel-approvals.json).

## 실제 반영한 내용

- 상품 등록/재조회 검사 130개와 타입 검사를 통과했다. SmartStore의 구식 테스트 입력에 현재 카테고리 검증 기록·원상품 결속·전송 본문 staging을 추가했다. 판매중지 CREATE, 심사대기 WAIT, UI 저장/복원 후 실제 POST→모의 provider CREATE 1회까지 검사한다. 운영 검증 조건을 완화한 변경은 없다.
- 운영 등록 승인 기록은 이전 `fd426cc`에 묶여 효력이 없었다. 현재 배포 `191e5cc02789d4b1dfdbedb0ae0ad08db07fa510`의 8개 어댑터와 재조회 코드 확인을 기록하고 등록 gate를 열었다. 실제 DB `effectiveOpen=true`, 현재 배포 일치, orphan/queued/running/reconciliation 모두 0을 확인했다. 이 승인은 상품별 원장·키·정책·중복 방지 조건을 대체하지 않는다.
- Lazada의 국가별 IM 진단 완료 trigger가 다른 국가의 유효한 권한 확인 기록까지 superseded로 바꾸는 결함을 수정했다. 현재 IM 앱/토큰과 **각 국가 자신의 seller target**이 일치하면 다른 국가의 증거도 유지한다. 토큰 변경·국가 grant 제거·잘못된 판매자 증거는 계속 차단한다.
- DB 회귀 검사 6개에서 수정 전 결함을 재현하고 수정 후 MY/SG 공존, 국가 제거, 토큰 변경, 잘못된 증거, 권한 제한, 재적용 차단을 확인했다. migration `20260913082500_lazada_im_preserve_country_capabilities`를 현재 함수 본문 해시와 대조한 뒤 적용했다. 운영 journal의 이름/전체 SQL SHA256 `f8bc41181669f5c7069de38c46620d8b2dee14fea97ffd0cfa8015e92181cb38`가 로컬과 같다.
- 이 후속 변경은 DB 함수와 검사/문서다. Vercel 웹 코드와 Mac 코드는 기존 `191e5cc`로 유지한다. 불필요한 재배포로 확인한 릴리스 승인을 다시 무효화하지 않는다.

## 계정·승인의 정확한 상태

| 항목 | 실제 확인 | 남은 조건 |
|---|---|---|
| Shopee 개발자/셀러센터 | 두 사이트 모두 로그인됨. Couplit Online, live partner 2031489, 기존 메인 계정 gjrxn:main | 센터 로그인과 API 재승인은 별도 흐름 |
| Shopee API 승인 | 공식 개발자센터 Authorize→Next도 별도 인증 화면으로 이동함. 메모의 비밀번호로 로그인 성공 후 추가 OTP 요구. 이메일 인증 수단으로 전환함 | 현재 열린 Login to Shopee 탭의 이메일 OTP. 기존 exact 세션은 job 생성/코드 교환 없이 만료됐으므로 이후 새 세션을 사용해야 함 |
| Shopee 앱 키 | 공식 화면에 만료 `2026-09-15 00:59 (UTC+09:00)`와 2일 내 갱신 경고 | 키 교체 후 Vault 및 동일 판매자/각 숍 API 재검증 필요. 현재 키를 임의로 폐기하지 않음 |
| Lazada CS Bot | 앱 137571 Online, Security/System Tools/ERP IM Chat/Product Management/Product Information/Order Information 모두 Active. MY/PH/SG/TH/VN seller whitelist 모두 존재 | 앱 권한 재신청이 필요한 상황은 아님. 실제 IM 토큰 country grant는 현재 MY뿐 |
| Lazada 판매자센터 | 메모의 기존 판매자 계정 로그인 성공. MY Couplet Seoul, Seller Full Access | 셀러센터 로그인 자체가 다른 국가 IM grant를 발급하지 않음 |
| eBay | 새 Commerce Message 승인과 조회는 앞선 작업에서 완료. 자동 수집으로 시스템 알림 DB 저장 18건까지 확인 | 시스템 알림은 고객 문의/답변 완료 증거가 아님 |

Lazada 공식 문서는 Cross-border 승인 시 반환된 `country_user_info` 범위에서 토큰을 여러 국가에 사용할 수 있다고 설명한다. 현재 SellerPilot exact OAuth는 **MY commerce app 137451** 전용이며 `im_*` 불변 조건이 있다. 여기에 IM app 137571 코드를 넣으면 안 된다. IM Cross-border 전용 state/actor/credential 결속·일회 코드 교환·durable recovery·동일 5개 seller 검증을 갖춘 연결 경로가 남아 있다. 이 DB 수정만으로 해당 OAuth 경로를 구현하거나 다른 4개국의 실제 권한을 확보한 것은 아니다. [공식 승인 문서](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777).

## 운영 검증과 다음 실행 순서

- Mac gateway: 현재 SHA `191e5cc`, ready, active jobs 0, 최근 claim HTTP 200, 마지막 오류 없음.
- DB: backends 16, blocking 0, 장기 트랜잭션 0, deadlocks 0. temporary bytes는 누적 3,014,656이다. 시스템 메시지는 Lazada 13건/eBay 18건.
- 이번에는 새 상품 등록·고객 메시지 전송·송장 등록을 하지 않았다. 현재 중앙 원장에 적절한 고객 답변/출고 대상이 확인되지 않은 상태는 이전 체크포인트와 구분 없이 그대로 유지한다.
- 우선순위: Shopee OTP 후 새 exact 세션/8개 숍 grant와 API readback → 만료 전 partner key 교체/동기화 → Lazada IM Cross-border OAuth 경로와 5개 seller 검증 → 실제 국가별 조회 및 DB receipt → 대상이 확인된 상품/고객 답변/배송 검증.

전체 판매·CS·배송 완료로 판정하지 않는다. 준비된 로그인 탭을 보존하고, 이미 완료된 eBay 승인·DB 함수 복구를 다시 시작하지 않는다.
