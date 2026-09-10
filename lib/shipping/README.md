# 주문·배송 채널 실행 모듈

`channel-adapters.ts`에서 8채널 구현을 선택한다. 채널별 수정은 `channels/<channel>.ts`, 영역 공통 순수 helper는 `execution-shared.ts`에서 한다. 다른 업무 영역이나 다른 채널 실행기를 import하지 않는다.

[8채널 연결 지도와 채널별 지침](../../docs/channel-connections/README.md)을 작업 기준으로 사용한다. `npm run check:domain-boundaries`와 `npm run check:channel-boundaries`로 의존성 재발을 확인한다.
