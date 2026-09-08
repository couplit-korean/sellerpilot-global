# Temu v5 외부 worker retry 통합 preimage

관측 시각 `2026-09-08T23:56:04+09:00`, 최신 통합본을 읽기 전용으로 복제한 뒤 patch를 적용했다. 검증 도중 통합본의 11st/Qoo10 공통 변경으로 해시가 이동해 한 차례 재기준화했으며, 아래 값은 최종 6/6 fixture를 실행한 clone의 정확한 before/after다.

| 공통 파일 | patch 전 SHA-256 | patch 후 SHA-256 |
|---|---|---|
| `app/api/channel-gateway/worker/complete/route.ts` | `eead0bd2e6619093fe9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64` | `8d3c1b41f5db38c4eb6275ab82b7014206ba108d362c7200ffdc045a610bdd96` |
| `lib/channels/gateway-contract.ts` | `3210bedf2fd93342f23ceec0474bac3ccdb3901d84d5eb8e059c950e361fc037` | `d371180e2a132da711cd8dcff3996673cbd198c681bfa1158365c4e92709b5d4` |
| `scripts/ai-cli-worker.mjs` | `354d75b065eba9e266978820915c7e53c7dae8d907e1db3b058c01340fb4541c` | `8bbff07389d304b5c2a7149dfe911cc48edae6d59448f8dcb046f35f81324563` |

검증 clone에서 reverse apply한 세 파일 hash가 위 patch 전 값과 모두 일치했다. 원본 통합본에는 patch를 적용하지 않았다.

통합 시점에 공통 파일이 다시 이동했다면 hash 일치만 강제하지 말고 `git apply --check`와 관련 공통 변경 diff를 함께 확인해야 한다. V5가 수정하는 hunk는 Temu DTO, 외부 worker payload, 완료 route의 pre-snapshot durable retry 분기뿐이다.

