# External 400 → 430 → 530 적용 동결

목표: `phaseDBready`. 현재 판정: **부모 운영 적용 및 동일 fresh baseline post97 완료, history282. 정식 external import·승인 완료. 실제 provider 게시·readback E2E 미완료**.
외부 source/SQL 원본은 동결 상태이며 이번 점검에서 변경하지 않았다. 운영 DB/Storage/API 직접 호출 없음.

## 최신 운영 상태 · 부모 증거
- 부모가 300/500/600 적용·postread를 완료한 history279에서 external 400→430→530을 적용했다. 다음 부모 파일의 HTTP201과 단계별 sourceExact/history280·281·282를 확인했다.
  - `tmp/apply-external400-dd18d9dc380f-attempt.json`, `tmp/post-external400-reviewed.json`
  - `tmp/apply-external430-376917325f4b-attempt.json`, `tmp/post-external430-reviewed.json`
  - `tmp/apply-external530-21138c29abf5-attempt.json`, `tmp/post-external530-reviewed.json`
- 동일 fresh baseline: `tmp/external-279-final-capture.json`. 최종 `tmp/external-post97-current.json`의 `all_checks_passed=1` 확인. 원문 source SQL 변경 없음.
- bucket private/PNG 10MiB 확인. 외부 imports/audit/objects=0 및 Preview 실제 GET import200·원본 근거 6 paths/3 SHA는 부모 보고. 이 보완 작업은 운영 API·DB·Storage를 호출하지 않았다.
- **정식 external import 승인 완료:** 부모 `tmp/external-import-approved-postread.json` 확인. import `08acb37f-7ed0-40b0-8fb3-4a217a7ac912`, 승인 시각 `2026-09-06T03:19:01.781221+00:00`, status=approved/current=true/detailVersion=2. Storage objects 8, receipts 8, 서로 다른 pixel hash 8, bucket private. legacy Studio approved version=0을 그대로 유지했다.
- ko 문서 일치는 postread의 `koDocumentMatches=true`로 확인. ko/ja/en 전체 문서 hash 대조 pass와 sourceJob/listings/assignments/originalmetadata 4개 hash 이전 불변은 부모 보고이며, 이 postread가 제공하지 않는 별도 비교를 재검증했다고 주장하지 않는다.
- failed revision `09f8ea94-e140-4811-9dec-ef9ad8ac8045`는 failed 유지(부모 특정 revision 보고 및 postread revisionStatus=failed). 외부 승인을 Studio 성공으로 바꾸거나 원래 실패 이력을 덮지 않았다.
- **완료 아님:** 실제 provider 게시·readback E2E. Native Vault 암호화·다중 연결 동시성도 여전히 미검증.
- 이 증거 파일은 repo fixture에 복사하지 않는다. 파일 경로는 부모 비커밋 증거 보관소 기준이며 테스트 입력이 아니다.

## 이식 가능한 현재 테스트 계약
- `tests/fixtures/external-detail-schema-catalog.json`: 254개 함수 signature/body·definition hash/owner/ACL/settings, 기존 47 trigger, 17 table RLS/ACL·47 FK 및 141/142 함수 metadata만 포함. 함수 원문 dump·업무 row·업무 digest·UUID literal·자격증명·승인 없음.
- `tests/fixtures/external-detail-frozen-manifest.json`: 동결 400/430/530 파일 hash, 새 12개 함수 body hash와 alias ABI만 포함.
- 실제 업무 함수는 private encrypted v4 + repo의 100/140/141/142/110 및 300/500/600/400/430/530 원문으로 복원한다. 세션 preflight의 254개 raw source overlay는 제거했고, 원문을 옮기지 않고도 전체 정의·body·owner·실효 ACL·설정 254/254가 일치한다. 이 정확한 predecessor 복원을 위해 private v4 입력은 유지한다.
- 기존 환경 계약 `SELLERPILOT_BASELINE_FOLDER`를 필수 사용한다. 디렉터리에 `baseline.enc`/`baseline.key`가 있어야 한다. 마지막 slash 불필요. 로컬 고정 경로 fallback 없음. CI는 비공개 read-only mount로 제공해야 하며 둘 다 repo/cache/artifact로 복사하거나 출력하지 않는다.
- baseline 미제공: 명확한 오류와 exit1, pass0/fail1/skip0 검증. 성공 skip으로 처리하지 않는다. 잘못된 bundle/key도 복호화 또는 catalog equality에서 실패한다.
- wrapper test는 `external-detail-reviewed-wrappers.fixture.mjs`로 OS 임시 디렉터리에 SQL/manifest/postread를 매번 생성·검사하고 finally에서 삭제한다. 운영에 적용했던 wrapper/approval 파일을 읽거나 덮어쓰지 않는다. generator는 로컬 테스트 전용이고 운영 재적용 도구가 아니다.
- repo cwd 및 다른 cwd 모두 publication2 + wrapper1 = **3/3**, skipped0. 보호 wrapper 정상 적용3/불일치 rollback9/postread3 유지. 400 nullable pointer 외 full-column digest 제외 확대 없음.

아래는 과거 단계별 검증 이력이다. 당시 '대기/미정/현재' 표현은 위 최신 운영 상태로 대체된다.

## 실제 capture 대조 완료
- 부모 `tmp/external-live-capture.json`의 원천 함수 8개: 암호화 v4(2026-09-05T14:23:32Z)의 `prosrc` 및 `pg_get_functiondef` SHA256 모두 일치.
- v4 DDL에는 `pg_get_functiondef` 뒤 export용 `;`가 추가된다. 이 구분자만 제거하면 전체 정의 hash도 8/8 일치한다. 본문 whitespace 변경이나 hash 재승인 없음.
- v4 owner/revoke/grant 항목과 현재 ACL을 대조했다. public publish-context는 authenticated 전용, normalized register/mark/bind와 verification-source는 service_role, private helper는 owner-only. 정확한 함수 원문을 PGlite에 넣어 body/definition/security/volatility/search_path/owner/실효 권한 roundtrip 8개 통과.
- 현재 trigger 47개 중 44개: v4 trigger 정의와 함수 본문 hash 일치.
- 이후 3개: Lazada shipment guard/marker는 142 본문 hash `045fad…`, product inventory mirror는 141 본문 hash `c997f3…`와 일치. 이 세 개는 v4에 없으며 v4 통합 완료로 표시하지 않는다.
- Storage 정책: 부모 직접 검토. authenticated INSERT/DELETE 모두 sellerpilot-ai bucket 한정. capture도 정책 2개와 일치하며 새 bucket 허용 정책 없음. 가상 INSERT를 직접 실행해 증명한 것은 아니다.

## 기존 테스트의 실제 범위
- `external-detail-lifecycle-db.test.mjs`: native normalized binder와 asset-binding helper는 현재 실제 hash와 일치. 그러나 ownership은 `token == valid-token`, review-current는 status 확인, legacy verification-source는 `{legacyBranch:true}` 대체 함수였다.
- `tmp/external-handler-integration-review.test.mjs`: 실제 handler/GET + 400/430 + 당시 historical product triggers. **530 미실행**, 현재 141 mirror 및 전체 gateway trigger 조합 통합이 아니다.
- 따라서 기존 96/96 또는 handler 7/7을 실제 worker/530 전체 통합의 근거로 사용하지 않는다.

## 새 실제-source 확인
- v4 실제 `serverless_cs_job_is_owned`와 serverless allowed 함수 체인을 대체 없이 실행했다.
- 8채널 publication.verify + 유효 serverless_cs token/lease: 허용.
- gateway scope token: 거부. 만료 lease: 거부. 총 10개 경계 통과.
- 이는 gateway scope를 serverless_cs처럼 처리하라는 뜻이 아니다. 실제 serverless gateway 코드가 publication verification source RPC를 부르는 경로를 확인했으며 원래 scope guard를 유지한다.
- allowed-chain 원문은 v4에 있으나 이번 capture에는 hash가 빠져 있으므로, 현재 운영과 동일하다는 최종 확인은 부모 추가 READ 후 수행한다.

## 과거 phaseDBready 잔여 조건 (후속 검증·부모 적용으로 해소)
1. 부모만 `tmp/external-worker-boundary-read.sql` 실행 후 결과 제공. 함수 원문/ACL만 읽고 token·고객·job payload 행은 출력하지 않는다.
2. 현재 8개 함수, allowed/deadline/완료 helper, 141 mirror·142 shipment trigger를 실제 source fixture에 함께 구성해 400→430→530 검증. 특히 원래 review-current의 listing/attempt/remote receipt/deadline/check-count/lease 조건을 status-only stub으로 대체하지 않는다.
3. normalized register → mark-uploaded → bind → provider receipt → 실제 review-current → external verification-source → verifier 완료 경계의 정상/오류 동작 검증. signed 원본이 구매자 자산으로 남지 않도록 기존 거부 조건 유지.
4. 위 통과 후에만 부모가 승인 capture와 적용 파일을 준비한다. 현 상태는 운영 적용 승인이나 실게시 완료가 아니다.

## 증거
세션 tmp: `external-capture-v4-comparison.json`, `external-capture-v4-details.log`, `external-worker-real-source-check.json`, `external-worker-real-source-check.mjs`.
로컬 fixture scratch와 문서만 생성했다. 암호화 baseline 키는 출력하지 않았고 protected SQL 파일은 읽지 않았다.

## 실제 완료 체인 추가 검증
- 추가 입력: 부모 `tmp/external-worker-boundary-live.json`. 7개 원문은 제공 hash를 확인하고 실제 정의 그대로 fixture에 적용했다.
- 신규 전용 파일: `tests/external-detail-real-publication.fixture.mjs`, `tests/external-detail-real-publication.test.mjs`.
- v4 원천 함수 폐쇄 집합 258개(63-byte PostgreSQL 식별자 축약·overload 포함), private 테이블/default/CHECK/PK/index, 당시 product/gateway trigger, 해당 함수 owner/ACL을 로컬에 구성했다. 함수 body stub 없음. auth.uid와 SHA256은 로컬 플랫폼 호환 구현이며 실제 DB/Storage/provider 호출은 없다.
- 2/2 통과. 실제 400→430→530 적용, 외부 승인, native register→mark-uploaded→8개 bind, 현재 native review-current/serverless ownership에 의한 readback, 실제 complete_gateway_transaction의 wrapper 체인, 최종 review=`live` 확인. 최종 receipt는 **합성 provider fixture**이며 운영 원격 검증을 주장하지 않는다.
- gateway scope와 잘못된 claim은 거부. review owner 변경과 source provider receipt 제거도 거부.
- **actor/issuer 추가 관측:** source/credential/listing owner를 유지한 채 verifier `created_by` 또는 token `created_by`를 다른 존재하는 합성 actor로 변경해도 readback 및 completion-context는 반환됐다. 이는 실제 기존 serverless ownership helper가 job↔token binding/scope/lease를 확인하고 created_by 일치를 검사하지 않는 결과다. 기존 정상 serverless 경로와 gateway 거부는 그대로 유지한다. 외부 코드가 제거한 guard로 단정하지 않지만 actor/issuer 일치 보장이 있다고도 주장하지 않는다. 운영 worker 발급·claim 신뢰 모델과 이 관측의 부합 여부는 부모 확인 사항이다.
- 한계: complete 276-history replay, native 동시성, provider 실응답, 141 mirror/142 shipment 신규 trigger 조합은 이 fixture 통과의 범위 밖이다. v4 이후 세 trigger는 source hash 대조만 완료했다. table FK/RLS 전체 복원 증명도 아니다.
- 따라서 핵심 publication 체인 공백은 해결됐지만 `phaseDBready` 최종 승인값은 여전히 부모가 판단한다. 400/430/530 원본은 수정하지 않았다.
- 재실행: `node --import tsx --test tests/external-detail-real-publication.test.mjs`. 결과: `tmp/external-real-publication-final.log`.

## 141/142 결합 및 대상 보안/FK 보강 완료
- 앞 절의 141 mirror/142 shipment trigger 미포함 한계는 이번 결과로 해소됐다. 두 migration을 원본 그대로, source preimage guard/ACL 조건을 유지해 fixture에 먼저 적용한 뒤 400→430→530을 실행했다.
- 현재 capture의 product/gateway trigger 47개 모두 정의·enabled·본문 SHA256 일치. 부모 141/142 postcondition의 함수 MD5·ACL도 일치.
- 실제 source closure 262개, affected table 19개, 필수 FK 51개. 해당 테이블의 v4 RLS/policy/owner/grant/revoke와 실제 FK를 복원하고 새 141/142/400 테이블 보안을 SQL 원본대로 적용했다. 19개에는 미적용 external import/audit 2개가 포함된다.
- 기존 2/2 전체 흐름 통과: 외부 승인→8개 register/mark/bind→현재 source readback→실제 완료 RPC→review live. 141 실제 bootstrap으로 inventory binding을 둔 상태에서도 승인/완료가 기존 재고와 revision을 변경하지 않는다.
- Shared-workspace actor/issuer 범위를 축소하지 않았다. 실제 claimed token ID, 단일 active token/scope 제약, claim, token 만료, lease, review owner, source fingerprint, provider receipt 누락 거부를 검증했다.
- **발견된 구체적인 source P1 없음.** 141/142/400/430/530 수정 없음.
- 현재 private table catalog는 기존 부모 function/trigger capture에 없으므로, v4 capture + 동일 적용 SQL에 근거한 로컬 보안/FK 검증과 현재 운영 table snapshot 일치를 구분한다. 부모용 좁은 SELECT: `tmp/external-affected-security-read.sql`. 로컬 비교 대상: `tmp/external-affected-security-fixture.json`. 운영 적용 전 external 신규 테이블 2개와 products의 신규 external FK는 아직 없다는 점을 제외하고 대조한다. 이 조회는 사용자 데이터/토큰을 출력하지 않는다.
- 목표 phaseDBready는 이 대상 관계의 적용 전 준비 상태다. 전체 276-history/native concurrency/모든 PG 보안 동등 복원/실 provider 게시 성공 증명을 요구하거나 대신한다고 쓰지 않는다.
- 최종 로그: `tmp/external-forward-security.log` (2/2). 운영 직접 접근/적용/승인 boolean 작성 없음.

## 최종 현재 catalog 대조 완료 · source 738934e
- 부모 `tmp/external-affected-security-live.json`과 fixture를 프로그램으로 대조했다. 현재 테이블 **17/17**의 owner/ACL/RLS/force-RLS, 정책 **0개**, FK **47/47**의 정의·validated가 모두 일치. 예상 밖 차이 없음.
- `channel_credentials`의 RLS=false도 실제와 v4가 일치하는 기존 상태다. owner-only table ACL을 유지하며 임의로 변경하지 않았다.
- fixture의 테이블 19개/FK 51개와의 차이는 external import/audit **2개 테이블** 및 **4개 FK**(products pointer 포함)로, 400의 예정 변경과 정확히 일치한다.
- 최종 **2/2 재통과**, 독립 선택 build/check **1/1 통과**. 기존 권한·scope·claim·lease·review/source 결속 유지. 남은 구체적인 source P1 없음.
- 따라서 목표 `phaseDBready`의 **대상 관계 적용 전 근거는 완성**됐다. 전체 PG 보안 동등 복원, 276개 migration 재생, 원격 provider 실게시 또는 운영 적용 완료를 의미하지 않는다.
- 실제 로컬 HEAD=`738934e` 확인. PreviewReady/saved-login 실원장 확인 및 Production c3 불변은 부모 보고이며 이 세션에서 운영을 재조회하지 않았다. 부모의 다른 SQL 선행 여부/적용 순서는 아직 미정, 현재 history276은 부모 제공 상태다.
- 승인 flag 작성 0, 운영 직접 호출/적용 0. 141/142/400/430/530 SQL 원본 변경 0.

### 독립 실행 명령
체크아웃한 리포 root에서 실행한다. 로컬 PGlite만 사용하며 배포/build 서버를 시작하지 않는다. 새 SQL 파일을 디스크에 복호화하지 않고 암호화 v4를 메모리에서 읽는다.

선택 fixture build + 현재 보안/trigger 대조:
```sh
# 먼저 SELLERPILOT_BASELINE_FOLDER를 private bundle 디렉터리로 설정
node --import tsx --test --test-name-pattern='^captured trigger hashes' tests/external-detail-real-publication.test.mjs
```

전용 두 테스트 전체(실제 publication 완료 체인 포함):
```sh
node --import tsx --test tests/external-detail-real-publication.test.mjs tests/external-detail-reviewed-wrappers.test.mjs
```

현재 필요한 외부 입력은 `SELLERPILOT_BASELINE_FOLDER`의 private encrypted v4 bundle/key뿐이다. 모든 catalog metadata는 repo fixture에 있으며 부모 세션 JSON/tmp/artifacts 입력은 필요 없다. 키를 출력하거나 repo에 복사하지 않는다.

### 125 preconditions / 97 postconditions 유효성 및 재capture
- 패키지: 세션 `artifacts/external-detail-deployment-checks/`. `node build-checks.mjs` 재실행으로 동결 migration SHA, 새 함수 12개, **pre125/post97 유지**를 확인했다. 검사 SQL 수정/완화 없음. 이는 운영에서 125/97을 이미 실행·통과했다는 뜻이 아니다.
- 기존 `external-live-capture.json`에 141/142의 새 trigger 3개가 이미 포함되어 있고 최종 hash도 일치한다. **141/142를 이번 fixture에 추가했다는 이유만으로 재capture할 필요는 없다.**
- 다만 부모의 적용 순서가 미정이므로, **실제 선행 SQL을 확정·적용한 뒤 400 직전** quiet window에서 `00_capture.sql`로 fresh baseline을 잡는 것을 최종 운영 절차로 한다. 영향 있는 함수/trigger/RLS/ACL/FK가 바뀌었다면 worker-boundary/affected-security READ도 다시 받아 같은 대조를 수행한다. 과거 approved snapshot을 그대로 재사용해 순서 변경을 덮지 않는다.
- 부모가 fresh capture를 검토·승인한 경우에만 `bind-checks.mjs <부모승인-baseline.json> pre`로 실행본 생성 후 **400 직전 pre125** 실행. 본 assistant는 그 승인 boolean/파일을 생성하지 않았다.
- **400 → 430 → 530**, 원본 그대로 순차 적용. 중간에 다른 migration/업무 쓰기/import 예약/업로드/승인/worker 게시를 끼우지 않는다. 각 파일은 자체 transaction이므로 실패 시 다음 파일 실행 금지.
- 같은 fresh pre-baseline으로 `bind-checks.mjs <부모승인-baseline.json> post` 생성 후 **530 완료 직후 post97** 실행. 125는 신규 객체 부재를 요구하므로 400 이후에 재실행하는 검사가 아니다. 97은 세 파일 전체 적용 후에 실행한다.
- pre/post 사이에 재capture하여 이미 발생한 변화를 정상 baseline으로 덮지 않는다. 부분 적용이면 pristine pre125는 의도대로 실패하며 상태 판독 후 부모가 복구 판단한다.
- 125/97은 함수·trigger·Storage·대상 business 값 불변 검증이다. 이번 현재 affected-table RLS/ACL/FK 대조 및 실제-source 2-test 회귀가 **추가 근거**이며, 이 근거가 원래 검사 항목에 자동 포함되었다고 주장하지 않는다.

최종 증거: `tmp/external-affected-security-comparison.json`, `tmp/external-phaseDBready-final.log`, `tmp/external-phaseDBready-selected-build.log`.


### 다른 cwd / CI 실행 예
```sh
# REPO: dependency 설치가 끝난 checkout의 절대 경로
# SELLERPILOT_BASELINE_FOLDER: CI 비공개 read-only mount 경로
node --import "$REPO/node_modules/tsx/dist/loader.mjs" --test \
  "$REPO/tests/external-detail-real-publication.test.mjs" \
  "$REPO/tests/external-detail-reviewed-wrappers.test.mjs"
```
CLI의 `--import tsx` 자체는 현재 cwd에서 package를 찾으므로 다른 cwd에서는 위 loader 경로를 쓴다. 테스트 내부 repo 입력은 모두 `import.meta.url` 기준이다. 부모 운영 승인·고객/credential row·baseline key를 포함하는 테스트 artifact는 만들거나 commit하지 않는다.
