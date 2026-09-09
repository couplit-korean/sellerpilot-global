# 병렬 개발 재개와 완료 대기 구분 — 2026-09-09

중앙 기준1c834d3a47. 전체19/48=39.6%는 완료한 검증 항목 수이며 남은60.4%가 모두 단순 코드 작성이라는 뜻은 아니다. 그렇더라도 Temu seller identity 계약과 Lazada callback 로컬/운영 차이처럼 외부 승인과 독립적인 미완료 개발을 승인 대기로 함께 묶으면 안 된다.

## 현재 배정

| 담당 | 재개한 실제 작업 | 제약 |
|---|---|---|
| 중앙/Shopee | exact SG helper 중앙 검토/적용, API/cache/DB 계약 통합 | 운영 migration 적용은 별도 보류 |
| Temu | 공식 읽기 응답 기반 seller/shop/region/credential identity 계약 | Inactive provider 반복호출 금지 |
| Lazada | 정상 authorize start 및 callback의 exact-only 잔존 검토/수정 제안 | 만료state/중복승인/운영재시도 금지 |
| 11번가 | 이미 승인된 저장 credential로 정상 읽기 API 검증 가능 여부 확인 | 2차인증/접근거절 우회, 신규키 발급 금지 |
| Qoo10 | 정상 저장 credential API 읽기 및 기존 조회증거 확인 | 실제 회신은 다른 C02 worktree라 계보 불일치 확인 중; 같은 GET 반복 안 함 |
| eBay | 정상처럼 보이는 HTTP200+errors를 진단 helper가 verified로 판단하는 문제 보완 | OAuth/provider/DB쓰기0 |
| 스마트스토어 | 신규상품 확정 후 실제 필수값/CREATE 검증 | 현재 유효한 신규상품 없음 |
| 쿠팡 | 신규상품 확정 후 실제 CREATE 검증 | 과거 생성SKU 재등록 금지 |

Temu/Lazada/11번가/Qoo10/eBay의 active/inProgress 상태를 묶음조회로 확인했다. 메시지 전송 접수만으로 재개를 주장하지 않았다. 중앙에서는 Shopee005 두파일 before absent/after SHA를 확인해 추가했으며 비정상 숫자시계/버퍼가 만료검증을 우회하지 않도록 보완했다. 관련16/16 및lint통과. 실제 API/RPC연결은 아직 미완료다.

Qoo10은 새 회신에서 2026-09-09T09:13:16.828Z의 QAPI200/ResultCode0을 보고했다. 원본은 /Users/kimchangheemac/dev/sellerpilot-channel-qoo10/docs/channel-handoffs/qoo10-status.md이며 현재 중앙 분담 폴더 /Users/kimchangheemac/dev/sellerpilot-product-qoo10-20260909와 다르다. 해당 C02의 중앙도 쿠팡taskId로 기록돼 있다. 다른 계보의 UPDATE 코드는 이번 신규등록 기준본에 섞지 않는다. 보고원본과 지정폴더 불일치를 확인하도록 요청했고 현재 계정/API수치는 증거귀속을 확인하기 전까지 그대로 둔다.

이 문서는 idle을 완료로 오인하거나, 외부 선행조건 때문에 할 수 있는 개발까지 중단하지 않기 위한 현재 작업 배정이다. 새 분담 작업/중복 자동화를 만들지 않았다.

추가수신: eBay005 최종제출(d802e262ca0b5a556c4600e6db7ebccccc7c441b, 보고d2eb06961eb674b31cc9906524bc1bdadcd98679) 도착. HTTP200+errors 혼합응답을 잘못verified하는 반례를 고쳤다고 보고했고 전용7/7 통과. 진단4파일의 중앙적용은 별도검토대상으로 접수했으며 기존preflight/004는 변경없음.
