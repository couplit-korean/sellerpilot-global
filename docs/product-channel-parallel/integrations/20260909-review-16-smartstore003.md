# SmartStore 신규등록003 r2 중앙 검증

중앙 의존 source 5개 해시와 test ABSENT를 확인하고 frozen patch를 빈 scratch에서 apply check/apply했다. 최종 test SHA-256 `321a6365607202bfeafd6bb10576c001f94a0f5d40bca4637a34c6eb2505e715`를 검증한 뒤 중앙에 추가했다. patch SHA-256은 `9b7303ca1962b20794ac9d2524e22229c67b0337cb37ea18d1542b425115c84f`다.

미열거 import를 자동 성공시키던 Proxy를 제거하고, 명시 fixture 이외의 상대 import를 실제 route 기준으로 읽도록 했다. 외부/해석 불가능한 import는 예외로 실패한다.

중앙 관련46/46, 전체 non-incremental TypeScript, 대상 ESLint 통과. 로그: `.local/product-channel-inbox/review16-smartstore-tests.log`, `review16-smartstore-tsc.log`, `review16-smartstore-lint.log`. production source 변경이 없는 test-only 추가이므로 직전 통과한 전체 build를 반복하지 않았다.

실제 workbench helper → draft PUT/GET → 복원 → actual POST → provider preparation을 검사했다. 미완성 KC 결정은 mock provider transport0으로 거부되고, 완성된 필드는 category/search/image preparation까지 전달된다. 최종 CREATE는 실행하지 않는다.

Auth/RPC, manifest binding, shipping assertion, publication verification 및 gateway 등은 명시 mock이다. 실제 브라우저 사용자 입력, 해당 mock 계약 자체, 운영 DB/API 또는 신규등록 성공 증거로 확대하지 않는다. C03 기존 상품 successor와 별도 계보이며 그 제안은 계속 검토 대기다.

현재 신규등록 증거19/48과 완료0/8 유지. 중앙 추가 파일은 미커밋이며 provider/DB/배포 변경 없음.
