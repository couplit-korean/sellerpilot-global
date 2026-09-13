# 나랑드 6장 입력 → 이미지 → 상세 → 채널 실등록 검증

사용자 최신 승인: 실제 채널 등록까지 Computer Use로 검증. 판매가 3,000 KRW, 재고 10, 500ml 1병. 포장 0.6kg/8×8×25cm는 사용자 승인 추정치이며 실측 완료 증거가 아니다. 같은 상품/원격 ID를 유지하고 중복 CREATE는 금지.

## 확인된 수정

- e60453e: Gateway 무료 사용량 제한 후 같은 분석 작업을 현재 Mac ChatGPT/Codex 작업자로 전환. 토큰·claim 바인딩, 동일 완료 RPC, 소유권 heartbeat, 실패/재시도 위치 표시. migration 20260913184858 source MD5 037d8a44d99ab9a24431bd5a258caa8c 운영 대조 완료.
- 00bf58a2-e843-4ff0-9667-526ee3720d23: Aside에서 다운로드 원본 6장을 모두 첨부. 1회 Gateway 제한 후 Mac 2회차로 분석 성공. 다른 면 5장 모두 identity=yes/0.99. 상품명 '나랑드사이다 제로 500 ml', 분석 결과 실제 DB 저장/UI 반영. 바코드 후보 8801097235014는 촬영 006에서도 확인. 다른 OCR 오독 경고는 남겨 둠.
- 이후 연출 8장 생성 CLI가 exit 0으로 종료해도 지정 경로에 파일이 없던 결함 발견. 호출 stdout/stderr 미보존 탓에 실제 반환 이유가 유실됐다. 기존 생성 이미지의 다른 세션 파일을 임의 채택하지 않음.
- 854e0b0: --json 호출 receipt의 thread ID와 해당 generated_images/session의 새 PNG 1장을 연결. 원본 파일/디렉터리 변조·symlink/hardlink·시각·크기·PNG 디코딩 검증과 wx 복사. 기존 픽셀/장면/중복 품질 검사는 유지. 12개 artifact tests 통과.
- 854e0b0: 선제작 상품 구성값이 수량 없는 상품명 반복일 때 판매자 확인 단품 보충 허용. 다른 상품·세트 증가 차단 및 manifest hash 유지(26개 회귀).
- 854e0b0: 해외 기준가 미입력 시 국내 3000을 USD/JPY 등으로 해석하지 않도록 신규 등록 차단. 단일/일괄/복원 초안 가드, 기존 내용 수정 가격 보존. 관련68개회귀/타입검사 통과.

## 현재 증거 범위

현재 상품 분석과 가공 이미지 8장 생성·저장·Aside 화면 표시까지 확인했다. 최종 상세는 최초 접수 후 gateway_forbidden으로 실패하여 같은 작업의 Mac 인계 경로를 수정 중이다. 상품 생성/판매채널 원격 ID/게시 완료는 아직 검증되지 않았다. 이 문서를 전체 완료 근거로 사용하지 않는다.

## 854e0b0 운영 반영 확인

- Vercel dpl_FwUuyCkdMKoy6g5dwfYAdnnnVD8Q 승격, 후보/운영 6개 canary 및 DB 활성화 완료. 등록 route 8개 release 및 adapter/rechecker 게이트 동일 SHA 확인.
- Mac AI 실행본 854e0b0 적용, 기존 00bf 작업 image queue 3회차 실행. 원본 6장 분석은 반복하지 않음. 첫 wide/portrait PNG 수령은 성공했으나 reserved-zone 검수에서 재생성됨; 파일 미수령 실패와 구별.
- Gateway 854e0b0, ready=true, activeGatewayJobs=0, 최근 수령 204 확인(19:29 UTC).
- eBay v208→209 및 Shopee v88→90의 기존 listing.create route 2개 credential_id만 갱신. 동일 provider_certified 판매자·관리자·token_refreshed 감사·활성 버전·정확 사전값 검증을 통과. 승인 범위/owner/operation/expiry 불변. Lazada는 기존 MY 계정과 최신 key의 동일 seller 확인 경로가 있어 불필요 변경하지 않음.

- 추가 원인: 실제 원본 배경 검수 기록에서 소비자 상품 정확성과 별개인 정밀 미술 수치(57도 나뭇결·70도 카메라·47도 조명·정확 cue 좌표) 때문에 반복 생성. CLI 한 호출 안에서도 82.7% 경계 위치를 맞추려 네 번 생성한 진단 확인. 단순 한도/파일 오류로 분류하지 않음. 상품 식별·라벨·실제 역할·중복 검증은 유지하면서 단일 재시도 관리와 명시적 prepared-detail 검수 계약을 수정 중.
- migration 20260914043300 source MD5 736ac05327a1335176b908529cccebba 운영 적용/원문·ACL·journal 확인. 현재 00bf 작업 updated_at=19:34:59 UTC, 조회 당시 heartbeat age22초로 기존 실행본의 자동 갱신 확인. 30분 경과 재수령 문제를 작업 중단 없이 수정.

## 추가 수정 검증

- prepared-detail-v1은 새 AI 배경, 원본 픽셀 동일성, 상품·사람·문자 혼입 금지, 카테고리 환경·역할, 실제 장면 차별성 및 SHA/dHash 검사를 유지한다. 정밀 미술 수치 일치는 수용 기준에서 분리한다. receipt v2에 실제 배경 hash/bytes/관측 단서와 생성·배치 profile을 저장하고 최종 상세는 같은 8장 bytes를 재사용한다. legacy v1과 새 profile 혼합·위장을 거부한다. 공용 계약 29개, 작업자 관련 49개 검사 통과. CLI 내부 중복 생성을 금지하는 한 호출당 image_gen 1회 지시 추가.
- 스마트스토어 공식 GENERAL_FOOD 고시로 전환. 내용량에 구성 1개를 대입하지 않고 명시적 값을 사용한다. 같은 상품·SKU·카테고리에서만 기존 고시를 보존하며, 공식 탄산음료 카테고리의 ETC 요청은 이미지 업로드 전에 차단한다. 관련 48개 검사 및 통합 타입 검사 통과.
- 실물 004 고해상도에서 F3를 독립적으로 두 번 판독하고 005 라벨에 연결해 생산자 대경사과원예농협음료가공공장, 경북 예천군 보문면 산단길 13-3을 확인했다. 전체 원재료도 사진 003·005·006으로 확보했다. 제조연월일 표시와 GMO 여부는 미확정으로 사용자에게 질문했으며 추정하지 않았다.

## 4ad4ccf 운영 반영과 실제 이미지 확인

- Vercel dpl_GsJ6r5VnpWgXZfdJXGyQ9EUvF6H5 READY 및 운영 승격 완료. 별칭 전파 직후 혼합 응답으로 활성화 검사가 한 번 거절되었고, 이후 운영 6개 canary가 모두 4ad4ccf로 일치한 뒤 DB 활성화했다. 등록 8개 route/adapter/rechecker release 일치 확인.
- Mac AI PID75643 및 로컬 Gateway를 동일 4ad4ccf로 반영했다. Gateway ready=true, activeGatewayJobs=0, 최근 수령 HTTP200 확인. 새 터미널 GUI 창은 열지 않았다.
- 같은 연구 job의 검증 완료 이미지 0개, 이전 실패 시도 3/3을 확인하고 수정 원인·release를 감사 기록에 남긴 뒤 허용 횟수만 4로 확장했다. 19:59:34 UTC에 4회차 시작; 사진 분석은 반복하지 않았다. heartbeat 갱신 유지.
- 새 실행 디렉터리 sellerpilot-first-draft-8DjsJF에서 실제 AI 배경과 합성 PNG가 생성됐다. wide 결과를 직접 열어 촬영 배경이 새 테라스 장면으로 바뀐 것을 확인했다. 다만 접지 그림자가 없어 병이 떠 보이는 결함을 발견했다. 결과 8장 저장/최종 상세/채널 게시 완료를 의미하지 않는다.
- 공식 동아블루몰의 나랑드 500ml 상품에 연결된 상품정보 고시 이미지(https://gi.esmplus.com/donga5678/narangd/nct500/nct500.jpg)를 브라우저로 확대 확인해 GMO 해당 없음을 확인했다. 같은 이미지의 '주문 접수 기준 9개월 이내 제조 상품 판매'는 해당 공식 판매점의 배송 약속이므로 이 판매자 상품에 전용하지 않는다. 실물 제조일 안내 값은 여전히 확인 대상이다.

## 같은 실행에서 발견한 후속 결함

- attempt4는 detail-context 마지막 역할의 배경 검수 실패로 종료됐다. 20:16:54 UTC 요청 상태 queued, attempts=4/max_attempts=4, verified_assets=0. 앞선 역할을 검수했어도 전체 생성 반환 뒤에만 업로드하는 구조라 저장된 부분 결과가 없었다. 파일 생성 수를 완료 수로 세지 않는다.
- 보존한 3차 detail-context 배경 감사에서는 안전성·카테고리·받침·장면 구분 항목이 모두 통과했고, 후경 난간과 창틀의 화면상 겹침만으로 reservedZoneClear가 false였다. catalog-scenes 지시를 실제 앞쪽 장애물과 뒤쪽 구조물로 구분하도록 좁게 보정했다. 검증값 강제 통과나 물체·문자·사람 검사 제거는 하지 않는다.
- 41b83b9는 실제 컷아웃 하단 알파 접촉 폭에만 접지 음영을 적용하는 수정이다. 입력 원본·불투명 상품 픽셀 보존 등 38개 회귀 통과. 이 커밋 당시 기존 worker의 메모리와 이미 생성된 사진에는 반영되지 않았다.
- 공식 고시 첫 문장 '상시제조품으로 정확한 제조연월일 고지가 어렵습니다.'를 제조일 안내로 확보했다. 실물의 특정 제조일을 확정하거나 공식 판매점의 출고 약속을 복제한 것은 아니다.

## 776a54c 실제 8장 완료와 화면 복원 수정

- Vercel dpl_dgzyXmNdaeXDeTcwRSvUQxT4L5af 운영 승격, 후보/운영 6개 canary, DB 활성화, 등록 8개 route 게이트, Mac AI PID82692 및 Gateway 동일 release를 확인했다. 같은 job에 최대 횟수 4→5만 감사 기록과 함께 확장했으며 사진 분석은 반복하지 않았다.
- 5회차에서 검수 완료 묶음을 공식 업로드·metadata readback으로 직렬 저장했다. 3/8, 6/8, 최종 8/8을 운영 DB로 확인했다. 20:44:43 UTC status=done, research result의 8개 역할 모두 segmented-source-composite이며 서로 다른 digest가 저장됐다. 정상 완료 직전 취소 조회 경쟁도 회귀로 검증했다.
- Aside 화면이 여전히 0/8로 대기한 직접 원인은 recover API의 원본 정확히 1장 제한이었다. 실제 job에는 6개 sourcePhotoEvidence가 있으나 recovery RPC가 해당 키를 빼고 반환하는 추가 결함도 확인했다.
- 복원 경로는 6원본 각각의 index·role·SHA와 실제 bytes를 확인하도록 수정했다. 제작 중 부분 저장은 202 pending으로 분리하고 완성 8개 bytes 검증은 유지했다. 소유자·관리자 권한은 유지하면서 RPC 응답에 기존 evidence만 추가하는 최소 migration을 작성했다.
- 브라우저가 409 등의 확정 복원 오류를 30분 동안 pending으로 숨기지 않도록 즉시 오류와 같은 작업 재확인을 제공한다. 재확인은 새 enqueue 없이 저장 결과만 조회하며 202 정상 대기는 유지한다. 복원 관련 29개, 브라우저 14개, 타입 검사 통과. 이 시점에서 최종 상세/상품 ID/채널 실등록은 아직 시작하지 않았다.

## ca897b4 운영·화면 확인과 최종 상세 접수

- Vercel dpl_39prEHxsAfqW4YMDRRN9UJsWFFsX 운영 승격 후 6개 canary가 ca897b4로 일치하고 DB 활성화·8개 등록 route gate·로컬 Gateway ready=true를 확인했다. 6원본 evidence 응답 최소 migration 20260914060000은 owner/admin ACL·기존 함수 보존 PGlite 검증 후 적용했다.
- 기존 Aside 폼을 새로고침하거나 6원본을 다시 분석하지 않고, polling으로 8/8 이미지가 표시됐다. 역할별 실제 이미지 확인 중 가로 카드의 중앙 cover crop으로 오른쪽 상품이 숨는 UI 결함을 확인했다. 새 탭에서 실제 1600×900 detail-context 파일을 열어 병·라벨이 정상적으로 포함됨을 확인했고, 갤러리만 contain으로 수정했다.
- 유사상품 가격 다시 확인을 실제 클릭해 기준 상품명 '나랑드사이다 제로 500 ml', 요청어 '나랑드사이다 제로'가 이번 요청으로 표시됐다. 공급자 오류/후보 없음은 가격 확인 불가로 남으며 최저가 성공으로 표시하지 않는다.
- 8장 검토 확인 후 상세페이지 제작을 1회 접수했다. product_studio a51eb670-9ae8-46f0-ba92-1c860f284ec6은 21:03:43 UTC 생성, 21:03:48 gateway_forbidden 실패. 아직 상품 ID/채널 CREATE는 없다. Vercel Studio catch의 같은 작업 Mac fallback 누락을 확인하여 수정 중이며 준비된 이미지 8장은 재생성하지 않는다.
- 사진005의 보관/개봉후 냉장/고온 밀폐장소 금지 문구를 직접 확인해 채널 식품 안전 고시 준비값에 추가했다. 해외 기준 USD2.24는 2026-09-11 ECB reference로 KRW3000을 환산한 준비값이며 최종 각국 통화 가격의 실시간 일치를 의미하지 않는다.

## 최종 상세 Mac 인계 보완 검증

- 신규 최종 제작(reuse_first_draft_assets=true)의 Gateway 연결 오류 5종만 exact job/claim/owner로 Mac에 인계한다. 불확정 RPC는503보존하며 failed로 덮지 않는다. 원본·digest·품질 실패, legacy/revision/개별 재생성은 제외한다. 서버 전체55개 및 보강3개 검사 통과.
- 신규 DB migration은 기존 claimer prosrc MD5 drift guard, 기존 공유 AI worker 권한과 서비스 ACL을 유지한다. Vercel은 studio_runtime=local을 받지 않고 Mac이 같은 job을 새 claim으로 수령한다. 7개 PGlite 검사 통과. 이 기록 시점은 작성·검증이며 운영 적용은 별도 확인한다.
- Mac은 상세 본문 전에8장을 받아 실제SHA를 확인하고 작업별 캐시에 저장한다. 본문후 캐시SHA와 기존facts/scene/manifest/PNG 검사를 다시 통과해야 재사용한다.1시간 signed URL 만료후 재다운로드하지 않는다. 신규4개+기존12개 검사 통과.

## 711cdb5 live Studio continuation

- Handoff migration applied: source MD5 b2d518369c96d8b2cb9818feb6503534, claim function d1a758c983a47f537655f9c82b12221e, handoff function 2fe66ef311d441f4b0daa7c86fd4efbb. Service-only ACL verified.
- Vercel dpl_EuXkpNXQVAZ4nwcy4z2DTnYg5RfW passed candidate and production six-route canaries. Runtime activated, eight listing gates aligned, Gateway ready on 711cdb5. Mac AI PID92900 uses the reviewed worker and cache helper.
- An exact guarded transaction resumed only a51eb670-9ae8-46f0-ba92-1c860f284ec6 locally. It preserved the old failed completion receipt in audit before retiring that receipt, retained attempt count and verified source lineage, and created no new job.
- Mac cached all eight prepared PNGs (16,848,573 bytes). Master text completed in 102567ms; localized segments then started in three concurrent lanes. This is not yet final completion or publication evidence.
- The enabled production reconcile_product_after_ai_success trigger attempts internal product binding on success. A narrow history action now also connects a completed job with no product ID through the existing idempotent product_create API. It serializes clicks and refreshes the ledger after uncertain replies. Five focused tests, four existing concurrency tests and TypeScript checks passed.

## Final auxiliary-label failure and text preservation

- ea6cade7 was promoted with six production canaries and all eight listing gates aligned. The existing Mac Studio process was not restarted during this UI-only release.
- The same Studio attempt completed master and all nine localized segments, verified and re-uploaded the exact eight prepared images, and uploaded hero/square/detail-feature. It failed at detail-package after three OCR comparisons (`unsupported-token, missing-token`) at 21:29:46 UTC. No product ID or channel CREATE was produced.
- The Mac detail-package exception used the unscaled selected source as its mandatory OCR baseline, unlike other deterministic source-evidence outputs. It now uses the independent, byte-verified rendered baseline at the same scale; selected packaging sources remain additional references. Actual Swift OCR fixtures and altered-label rejection passed. Vercel already uses this equivalent rendered baseline.
- The old CLI text invocations were ephemeral and their complete master/localized JSON existed only in the deleted jobDir. Exact-cwd session lookup and bounded diagnostics found no complete recoverable output. Partial diagnostic excerpts are not accepted as replacement artifacts. One new text generation remains necessary; the eight prepared images are retained.
- Studio text now persists outside cloud sync under `Library/Application Support/SellerPilot/studio-text-checkpoints` before image processing. The receipt binds job, owner, stable semantic request, ordered source digests and the prepared manifest to schema-checked JSON bytes with SHA256 and a domain-separated HMAC. Cache validation failures do not silently invoke the model. A later image failure can reuse complete text while all image checks still run. Helper tests 9/9, integration tests 4/4 and TypeScript checks passed.

## 6a946a1 execution and remaining source-evidence defect

- Vercel dpl_6EBEdwvbVBfTkRLepeuiS7AUeiHg passed candidate and production six-route canaries. Production activation, eight listing release routes and the idle Mac Gateway were aligned to 6a946a15b3d0f5ad6e27a01361cb79d3c2cf62cf. Mac AI PID96837 received the reviewed text-checkpoint and label-baseline implementation.
- The exact existing Studio job resumed as attempt3. Master completed in 113145ms; all nine localized chunks completed. Full schema-checked text was durably stored with SHA256 7bbc5e643963b1aacb4dc60cf077620ae629dd81d6258a661af1fc86b5bc3a04 (350192-byte private receipt file). All eight prepared assets passed the existing source/facts/scene checks and were reused without image generation.
- The previous detail-package OCR failure was resolved: its source evidence passed and compressed losslessly from 1962877 to 1849750 bytes. This does not establish completion of the entire Studio job.
- Attempt3 failed at 22:05:41 UTC because detail-material repeated the same full front-label source as detail-feature. Its retry advanced the counter but rendered the same source/layout again. The duplicate rejection was valid; the text checkpoint and original eight prepared images remain available. No product ID or channel CREATE was produced.
- The saved master and all 34 localized listing variants have zero detail-material references, but the current complete asset contract requires all 16 roles. This run preserves that shared DB/API contract. The bounded repair instead implements the existing material-macro role using actual visible source pixels and permits verified rear/barcode evidence for detail-feature, matching this job's nutrition-label section. Validation and the next release are separate steps.
- Consumer-copy corrections for the eight selected channel/market pairs were prepared from the photographed F3 producer, complete ingredient list and storage directions. They are proposals only; they have not been applied to the job or published. Shipping fee policy remains a pending user clarification; the default draft zero is not recorded as an approved free-shipping promise.

## Source-evidence repair validation

- Feature selection now prefers verified label/barcode/rear evidence. Material rendering crops actual visible exterior pixels with bounded, different source regions; it does not generate texture, change duplicate thresholds or relax OCR checks. Vercel material planning only selects whole exterior views its existing cutout verifier can process, avoiding the discovered close-label segmentation failure.
- Pre-run checks also reproduced contents/package duplication. Only seller-confirmed count-only single units now use a verified whole single product for contents, with the existing right-product/left-copy contents framing shared between Mac and Vercel. Bundles, 1+1 and unconfirmed contents retain dedicated-evidence requirements.
- Focused tests: new macro/contents boundaries 8/8, source planning 9/9, image-generation contract 22/22. TypeScript, worker syntax and diff checks passed. Actual prepared8 plus auxiliary8 fixtures passed all120 pair comparisons with minimum dHash distance72 against the unchanged64 threshold. This is pre-run validation, not a completed product or channel publication. User photos remain outside the repository.
