# 2026-09-13 로컬 CS 인증 갱신과 IM 복구 후속

운영 26dc3ee는 Vercel 후보 build/canary 후 승격했고, Supabase 활성 릴리스와 Mac gateway/AI 설치 버전을 맞췄다. 게이트웨이 ready/HTTP200을 확인했으나 개별 채널 작업의 성공을 대신하지 않는다.

## 수정 및 검증

- Shopee Mac CS processor가 숍별 refresh target을 버려 일반 갱신 RPC를 호출했다. CS 전용 top-level target을 begin/stage API에 보존하여 기존 숍별 잠금/CAS 함수로 연결했다. 일반 commerce worker 경로는 확장하지 않았다. DB 소유권은 유효한 Mac gateway token/lease, 승인된 해당 credential·seller·operation 경로, 현재 release/egress version, 공유 관리자 관계를 확인한 Shopee inquiries.list에만 추가했다. 실제 DB rollback에서 공유 관리자 정상 경로와 target lock acquired, 잘못된 claim·다른 operation·꺼진 route·과거 release 차단을 확인했다. migration20260913070000 적용.
- Lazada 진단 c24d02d4-667b-4915-8658-664a0932ac81은 새 IM token을 Vault recovery에 보존한 뒤 국가 정보 형식 검증에서 중단됐다. 기존 IM access/refresh와 값이 달라졌으므로 구 토큰을 재사용하지 않는다. country_user_info 및 country_user_info_list를 수용하되 둘이 충돌하면 recovery에 남기고 차단한다. 실제 응답 variant 확인과 seller/country 최종 proof는 후속 새 실행에서 수행한다.
- migration20260913071000은 실패 원장/receipt/recovery Vault를 보존하고 최신 토큰을 새 diagnostic으로 넘기는 서비스 전용 복구 경로다. 상품용 credential payload 및 identity 불변, 동일 IM app, 활성 source credential, recovery hash, 정확한 next job/claim을 확인한다. 실제 DB rollback에서 최신 recovery token만 전달, 일반 credential 불변, 같은 resume 요청의 동일 job, 잘못된 claim과 바뀐 recovery 차단을 확인했다. 실제 재개는 수정된 Mac 배포 후 수행한다.
- eBay 후속 시스템 알림에는 recipientUsername도 없는 것이 실제 HTTP200에서 확인됐다. FROM_EBAY 시스템 메시지만 null로 보존하고 인증된 계정의 시스템 알림으로 구분한다. 구매자 역할/답변 요건은 유지한다. migration20260913072000으로 해당 DB 조건만 forward 수정했다. 실제 provider GET 21단계로 시스템 알림21건 전체를 파서에서 통과했으며 이는 DB21건 수집 완료와 구분한다.
- 관련 검사117개와 타입 검사 통과. 위 세 migration까지 이번 복구 wave의 forward 적용27개이며, 전체 저장소 migration 또는 전체 E2E 완료 수치가 아니다.

## 실제 남은 검증

새 코드 배포/운영 활성화/Mac 동기화 후 Lazada recovery diagnostic→나라별 읽기 binding→bootstrap, Shopee 다중 숍 갱신→원장 완료, eBay 시스템 알림 전체 DB 투영을 확인한다. Temu 새 자동 문의 job3357798f-d694-4c98-b988-5f7ccd4f975a는 running이나 실제 worker active0/lease잔여가 관측돼 claim/완료 경계를 추가 조사한다. 11번가 Q&A·긴급알림의 새 자동 수집은 succeeded+receipt다. 경쟁 가격 snapshot_complete503도 별도 남아 있다.

실제 고객 답변, 신규 상품 게시, 배송 변경은 이 검사의 목적으로 실행하지 않았다. 모든 채널 종단 성공으로 표시하지 않는다.
