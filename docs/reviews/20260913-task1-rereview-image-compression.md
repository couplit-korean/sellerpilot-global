# 1번 재검토와 이미지 압축 적용 지시

2026-09-13 KST. 중앙 검토, canonical checkout `/Users/kimchangheemac/dev/sellerpilot-app`.

## 1번 재검토

이전 R1/R2 수정은 이번 로컬 재검토 범위에서 통과했다. 실제 React 19/happy-dom hook 테스트를 포함한 아래 29개 테스트를 중앙에서 다시 실행하여 29 pass / 0 fail을 확인했다.

```sh
node --import tsx --test tests/publishing-task/*.test.ts tests/product-registration-mvp-flow.test.mjs tests/product-research-ui-retry-photo-contract.test.mjs tests/product-research-lifecycle.test.ts tests/product-research-provenance.test.ts
```

- R1: effect setup의 fence.mount와 cleanup의 unmount가 세대를 분리한다. 일반 mount/StrictMode 모두 enqueue 1회, accepted true. StrictMode를 끄지 않았다.
- R2: token 부재/recover 401은 authentication-required로 처리하여 polling과 잠금을 종료하고 retry를 연다. 재로그인 후 접수된 job은 중복 enqueue 없이 recover를 재개한다. 최초 인증 실패는 정상 enqueue 재시도가 된다.
- 실제 unmount 뒤 늦은 응답, 이전 job 응답, 다음 job 격리, polling 제한 종료도 통과했다.
- 임시 원본 가공 6장과 검증된 생성 6장 구분, 역할별 표시, 사람 검토 전 상세 제작 gate에 대한 기존 회귀 검사를 함께 통과했다.

테스트 출력: `/tmp/sellerpilot-task1-rereview-tests.log`. 이 판정은 배포/실상품 생성/운영 브라우저의 종단간 검증을 의미하지 않는다. 전체 build와 운영 worker 변경은 수행하지 않았다. 검토 대상 소스는 중앙에서 수정하지 않았다.

## 압축 결정과 예비 측정

기존 sharp 0.35.4 / libvips 8.18.6를 기본 PNG 무손실 압축에 사용하고, OxiPNG(MIT)를 로컬 worker의 추가 압축 단계로 도입하도록 기존 2번 작업에 상세 지시를 전달했다. 모델은 GPT-5.6 Sol / High를 명시했다. 기존 I1~I4 수정과 파일 소유권을 유지한다.

공식 근거:

- https://sharp.pixelplumbing.com/api-output/ — PNG compressionLevel, adaptiveFiltering, palette 옵션. palette 양자화는 canonical master에 사용하지 않는다.
- https://github.com/oxipng/oxipng — 무손실 PNG optimizer, MIT, 최적화 단계별 시간/크기 tradeoff. --alpha는 투명 픽셀을 변경하므로 사용하지 않는다. 최고 단계나 Zopfli가 모든 이미지의 최소 크기를 보장하지 않는다.

저장소 데모 3장을 read-only로 읽고 sharp keepMetadata, PNG compressionLevel9, palette:false, adaptiveFiltering false/true와 입력 중 최소 크기를 선택했다. 고객 상품 생성 완료 샘플은 아니다. 압축 결과는 메모리에서만 측정했고 원본을 덮어쓰지 않았다.

| 데모 이미지 | 입력 bytes | 선택 bytes | 절감 | 두 후보 인코딩 및 비교 시간 | decoded RGBA |
|---|---:|---:|---:|---:|---|
| premium-studio.png | 1,564,069 | 1,471,495 | 5.92% | 1064 ms | 동일 |
| ingredient-flatlay.png | 2,123,516 | 2,006,899 | 5.49% | 482 ms | 동일 |
| daily-carry.png | 1,770,521 | 1,690,155 | 4.54% | 804 ms | 동일 |

이 결과는 OxiPNG 실측이나 고객 상품 압축률 보장이 아니다. OxiPNG 설치/통합/회귀 검증은 2번에 전달된 진행 작업이다.

## 2번에 전달한 완료 조건

1. 서버와 Mac의 실제 1차/2차/상세 합성 결과 경로에 공통 최적화를 연결한다. 압축 후 최종 bytes로 outputSHA/visualHash/receipt/manifest를 만들고 업로드한다. 원본 SHA와 기존 승인된 reuse 파일을 임의 변경하지 않는다.
2. 픽셀/색상/alpha/치수/필요한 metadata를 보존하고 더 작을 때만 채택한다. 지원 밖 입력은 무손실이라고 주장하며 변환하지 않는다.
3. 로컬 OxiPNG는 버전과 출처를 고정하고 실제 측정한다. 프로세스 인자 배열, timeout, 고유 임시파일, 자원 제한, 실패 시 검증된 원본/sharp fallback을 구현한다. Vercel은 native OxiPNG 설치 없이 sharp 경로로 작동한다. 무거운 Zopfli는 bounded local 작업으로 제한한다.
4. 바이너리 없음/실패/timeout, 이미 최적화된 이미지, 투명/ICC/bit-depth 지원 범위, never-larger와 업로드 digest 일치를 실제 인코더로 검사한다. 산출물별 절감과 시간을 보고한다.
5. PNG 계약을 유지한다. 채널 JPEG 변환 등 4번 파일과 1번 UI를 수정하지 않는다. 기존 worker를 재시작하거나 운영 파일을 교체하지 않는다.
6. 큰 파일은 signed Storage 직접 전송하고 API에는 작은 metadata만 보낸다. 압축을 Vercel 본문 제한 해결의 유일한 수단으로 사용하지 않는다.

이 문서 시점: 1번 로컬 재검토 통과, 압축 예비 측정 완료, 2번 추가 구현 지시 전달 및 active 상태 확인. 압축의 운영 적용 완료 상태는 아니다.
