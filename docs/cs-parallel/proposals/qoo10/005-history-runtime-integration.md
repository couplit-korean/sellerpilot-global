# Qoo10 history runtime 공통 연동 제안 qoo10-005

## 결론

Qoo10 전용 구현은 `Asia/Tokyo` 달력일마다 `S1/S2/S3/claim` 네 창을 만들고, 공급자 상한 또는 total 불일치가 있으면 `day -> hour -> minute -> second`로 세분화한다. 공통 실행기는 아래 export만 호출하고, DB는 창별 완료 상태와 부모/자식 계보를 별도 원장에 보존해야 한다. 한 창의 HTTP/QAPI 성공을 전체 기간 완료로 바꾸면 안 된다.

- S0: `S0-20260908-decaba426812a3ba`
- 로컬 export: `qoo10HistoryExecutionRequests`, `qoo10HistoryArguments`, `qoo10HistoryWindowFromArguments`, `assessQoo10HistoryExecution`, `executeQoo10HistoryWindow`
- provider mutation: 없음. `inquiries.list`의 `GetInquiryMessage`/`GetClaimInfo_V3`만 사용한다.
- 개인정보: coverage와 fixture에는 digest/count만 남기며 주소, 연락처, 구매자 ID, 고객 원문을 넣지 않는다.

## 통합본 preimage

아래 해시와 다르면 이 패치를 기계 적용하지 말고 새 통합본에서 다시 diff를 만든다.

| 공통 파일 | SHA-256 |
|---|---|
| `lib/channels/sync-arguments.ts` | `17a7670bc5ed8ca6237c412aa80a30b36af337585d3a34f22cb540735424a7a2` |
| `app/api/operations/sync/route.ts` | `71ef296055feff2c6d7dfb9b5e51b24337766f16cc13e874f2086c2e9c2f9f91` |
| `app/cs/history-window.tsx` | `b58adcbb4ca8fc6757d830143939fb0ffc514fd37056c6f24442f1adf8ee7f04` |
| `app/page.tsx` | `153db8ff7e77c428acefbe560f03f0d4d2be3f4e6e4a5c1dcbb4f9d65943ba96` |
| `app/api/channel-gateway/worker/complete/route.ts` | `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64` |
| `lib/channels/inquiry-coverage.ts` | `c2dcb994c2852d7701f357a8f622eaa1541e574d638b5b49d1a4b0c89b8988fe` |
| `supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql` | `cf1f0941c7cc21b0604ca20d3b817914cb62c07659858d648e7e3e37fbc02c19` |

## Before / after

| 경계 | Before | After |
|---|---|---|
| 30일 repair | S1/S2/S3/claim 네 개의 넓은 창이며 종료가 선택일이 아닌 `now`일 수 있음 | 정확한 30개 일본 달력일 x 4 = 120개 독립 창 |
| 기간 지정 | 종료일 + 고정 30일, Qoo10 거부 | Qoo10은 시작일/종료일 직접 지정, 한 실행 최대 366일, 더 긴 기간은 인접 실행으로 모두 표시 |
| 완료 | provider 성공 및 generic projection count 중심 | `complete`, `unverified`, `incomplete`, `split`, `irreducible_gap` 구분 |
| 포화 | 페이지/continuation이 없으면 완료처럼 보일 수 있음 | day/hour/minute까지 재분할하고 1초 포화는 영구 gap |
| 재개 | 실패 job 재큐잉 | 완료 leaf 제외, 실패/미검증 leaf만 재개, 같은 window key는 멱등 |
| 중복 | normalized event 수 중심 | type + question + sequence identity로 중복 관측, status 이동, sequence collision을 분리 |

## 정확한 TypeScript 패치

### 1. 공통 scheduler planner 교체

`lib/channels/sync-arguments.ts`에 다음 diff를 적용한다. 이 변경은 기존 함수 시그니처를 유지하므로 주기 복구 호출자에는 Qoo10 job 수만 4개에서 120개로 바뀐다.

```diff
diff --git a/lib/channels/sync-arguments.ts b/lib/channels/sync-arguments.ts
--- a/lib/channels/sync-arguments.ts
+++ b/lib/channels/sync-arguments.ts
@@
 import type { ActiveChannelKey } from "./catalog.ts";
 import { ebayAsqMarketplaceId, type EbayAsqMarketplaceId } from "./ebay-asq.ts";
+import { qoo10HistoryExecutionRequests } from "./cs/qoo10/history-runtime";
@@
   if (channel === "qoo10") {
-    return [
-      ...["S1", "S2", "S3"].map((status) => ({
-      periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:${status.toLowerCase()}`,
-      arguments: {
-        params: {
-          search_start_dt: qoo10Date(firstDay),
-          search_end_dt: qoo10Date(now),
-          proc_status: status,
-        },
-      },
-      })),
-      {
-        periodicKey: `inquiries:history:${firstDay.toISOString().slice(0, 10)}:${lastDay.toISOString().slice(0, 10)}:claim:all`,
-        arguments: {
-          kind: "claim",
-          params: {
-            search_Sdate: qoo10DateTime(firstDay),
-            search_Edate: qoo10DateTime(now),
-            search_condition: "2",
-          },
-        },
-      },
-    ];
+    return qoo10HistoryExecutionRequests(
+      firstDay.toISOString().slice(0, 10),
+      lastDay.toISOString().slice(0, 10),
+    );
   }
```

### 2. 지정 기간 UI/API 입력

`app/cs/history-window.tsx`의 callback과 버튼은 다음 계약으로 바꾼다. 기존 세 채널은 기존 종료일+30일 동작을 유지한다.

```diff
-  onBackfill: (channel: "coupang" | "elevenst" | "smartstore", endDate?: string) => Promise<void>;
+  onBackfill: (channel: "coupang" | "elevenst" | "smartstore" | "qoo10", endDate?: string, startDate?: string) => Promise<void>;
@@
+  const [startDate, setStartDate] = useState(() => new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10));
+  const qoo10Valid = valid && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
+    && startDate >= "2000-01-01" && startDate <= endDate
+    && Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) < 366;
@@
+      <label>Qoo10 시작일 <input aria-label="Qoo10 과거 문의 시작일" type="date" min="2000-01-01" max={endDate} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
+      <button className="filter-button" type="button" disabled={!qoo10Valid} onClick={() => void onBackfill("qoo10", endDate, startDate)}>Qoo10 지정 기간</button>
```

`app/page.tsx`의 타입 union과 요청 body에만 Qoo10 분기를 추가한다.

```diff
-  channels: Array<"coupang" | "elevenst" | "smartstore">;
+  channels: Array<"coupang" | "elevenst" | "smartstore" | "qoo10">;
@@
-      || value.channels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore")) return null;
+      || value.channels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore" && channel !== "qoo10")) return null;
@@
-  const syncOrders = useCallback(async (silent = false, historyDays?: number, historyChannel?: "coupang" | "elevenst" | "smartstore", historyEndDate?: string) => {
+  const syncOrders = useCallback(async (silent = false, historyDays?: number, historyChannel?: "coupang" | "elevenst" | "smartstore" | "qoo10", historyEndDate?: string, historyStartDate?: string) => {
@@
-          ? { channels: historyChannel ? [historyChannel] : ["coupang", "elevenst", "smartstore"], historyDays, ...(historyEndDate ? { historyEndDate } : {}) }
+          ? { channels: historyChannel ? [historyChannel] : ["coupang", "elevenst", "smartstore"], historyDays, ...(historyEndDate ? { historyEndDate } : {}), ...(historyStartDate ? { historyStartDate } : {}) }
@@
-onBackfill={(channel, endDate) => syncOrders(false, 30, channel, endDate)}
+onBackfill={(channel, endDate, startDate) => syncOrders(false, 30, channel, endDate, startDate)}
```

`app/api/operations/sync/route.ts`는 `historyStartDate`가 있을 때 오직 `channels=['qoo10']`, `historyEndDate` 존재, 366일 이하를 허용하고 아래 새 RPC를 호출한다. 결과 schema의 channels union에도 `qoo10`을 추가한다. Qoo10은 현재 확인된 QAPI 계약상 static-egress 필수 채널로 추정해 넣지 말고, 실제 배포 정책이 있을 때만 별도 gate를 추가한다.

```diff
+import { qoo10HistoryExecutionRequests } from "../../../../lib/channels/cs/qoo10/history-runtime";
@@
+  historyStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
@@
-  historyDays: z.number().int().min(7).max(30),
+  historyDays: z.number().int().min(1).max(7305),
@@
-  channels: z.array(z.enum(["coupang", "elevenst", "smartstore"])).min(1).max(3),
+  channels: z.array(z.enum(["coupang", "elevenst", "smartstore", "qoo10"])).min(1).max(3),
@@
-  const historyChannels = (parsed.data.channels ?? []) as Array<"coupang" | "elevenst" | "smartstore">;
+  const historyChannels = (parsed.data.channels ?? []) as Array<"coupang" | "elevenst" | "smartstore" | "qoo10">;
@@
-        || historyChannels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore"))) {
-    return NextResponse.json({ message: "과거 문의는 쿠팡, 11번가 또는 스마트스토어 중 한 채널씩 불러와 주세요." }, { status: 400 });
+        || historyChannels.some((channel) => channel !== "coupang" && channel !== "elevenst" && channel !== "smartstore" && channel !== "qoo10"))) {
+    return NextResponse.json({ message: "과거 문의는 지원 채널 중 한 채널씩 불러와 주세요." }, { status: 400 });
@@
+  const qoo10Explicit = parsed.data.historyStartDate !== undefined;
+  if (qoo10Explicit && (parsed.data.historyEndDate === undefined
+      || parsed.data.channels?.length !== 1 || parsed.data.channels[0] !== "qoo10")) {
+    return NextResponse.json({ message: "Qoo10 과거 문의 시작일과 종료일을 한 채널 범위로 지정해 주세요." }, { status: 400 });
+  }
+  const qoo10Requests = qoo10Explicit
+    ? qoo10HistoryExecutionRequests(parsed.data.historyStartDate!, parsed.data.historyEndDate!)
+    : null;
+  if (qoo10Requests && qoo10Requests.length > 366 * 4) {
+    return NextResponse.json({ message: "Qoo10 이력은 한 번에 366일 이하로 나눠 주세요." }, { status: 400 });
+  }
+  const fixedEgressHistoryChannels = historyChannels.filter((channel) => channel !== "qoo10");
@@
-      historyChannels,
+      fixedEgressHistoryChannels,
@@
-    const databaseReady = historyChannels.every((channel) => policy[channel] === true);
+    const databaseReady = fixedEgressHistoryChannels.every((channel) => policy[channel] === true);
@@
-      "sellerpilot_start_inquiry_history_backfill_v4",
-      { p_channels: historyChannels, p_history_days: parsed.data.historyDays, p_end_date: parsed.data.historyEndDate ?? null },
+      qoo10Requests ? "sellerpilot_start_qoo10_history_backfill_v1" : "sellerpilot_start_inquiry_history_backfill_v4",
+      qoo10Requests
+        ? { p_start_date: parsed.data.historyStartDate, p_end_date: parsed.data.historyEndDate, p_requests: qoo10Requests }
+        : { p_channels: historyChannels, p_history_days: parsed.data.historyDays, p_end_date: parsed.data.historyEndDate ?? null },
```

## 완료 처리와 DB 계약

통합 migration은 기존 migration을 고치지 말고 새 번호로 생성한다. 아래 객체/제약을 그대로 구현한다.

```sql
create table sellerpilot_private.qoo10_history_windows (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references sellerpilot_private.channel_credentials(id) on delete cascade,
  job_id uuid unique references sellerpilot_private.channel_gateway_jobs(id) on delete set null,
  window_key text not null check (window_key ~ '^inquiries:history:qoo10:(inquiry:S[123]|claim:all):[0-9]{14}:[0-9]{14}$'),
  source text not null check (source in ('qapi_inquiry','qapi_claim')),
  inquiry_status text check ((source='qapi_inquiry' and inquiry_status in ('S1','S2','S3')) or (source='qapi_claim' and inquiry_status is null)),
  calendar_date date not null,
  refinement text not null check (refinement in ('day','hour','minute','second')),
  parent_window_key text,
  completion_state text not null default 'queued' check (completion_state in ('queued','running','complete','unverified','incomplete','split','irreducible_gap','failed')),
  completion_reason text,
  provider_row_count integer check (provider_row_count is null or provider_row_count >= 0),
  provider_total integer check (provider_total is null or provider_total >= 0),
  observed_row_limit integer check (observed_row_limit is null or observed_row_limit > 0),
  updated_at timestamptz not null default clock_timestamp(),
  unique (credential_id, window_key),
  foreign key (credential_id, parent_window_key)
    references sellerpilot_private.qoo10_history_windows(credential_id, window_key)
    deferrable initially deferred
);
create table sellerpilot_private.qoo10_history_run_windows (
  run_id uuid not null references sellerpilot_private.inquiry_history_backfill_runs(id) on delete cascade,
  window_id uuid not null references sellerpilot_private.qoo10_history_windows(id) on delete cascade,
  primary key (run_id, window_id)
);
alter table sellerpilot_private.qoo10_history_windows enable row level security;
alter table sellerpilot_private.qoo10_history_run_windows enable row level security;
revoke all on sellerpilot_private.qoo10_history_windows,
  sellerpilot_private.qoo10_history_run_windows from public, anon, authenticated, service_role;
```

필요 RPC:

1. `sellerpilot_start_qoo10_history_backfill_v1(date,date,jsonb)`: authenticated admin 전용. active production Qoo10 credential의 owner/seller-account binding을 잠그고, `requests.length=(end-start+1)*4`, 모든 `periodicKey`·metadata·params·달력일을 검증한다. `(owner, credential, start, end)` request digest에 advisory transaction lock을 건다. 같은 창은 재사용하고 완료 leaf를 재큐잉하지 않는다.
2. `sellerpilot_service_record_qoo10_history_window_v1(...)`: service role 전용. worker token, claim token, job/credential/run/window key를 한 transaction에서 대조한다. `assessQoo10HistoryExecution` 결과와 child arguments를 받아 부모를 `split` 또는 leaf 상태로 기록하고, 각 child를 `(credential_id,window_key)` 멱등 insert한 뒤 `inquiries.list`로 enqueue한다.
3. backfill run refresh: gateway job `succeeded` 수만으로 완료하지 않는다. 모든 root의 leaf가 `complete`일 때만 `succeeded`; `unverified`, `incomplete`, `irreducible_gap`, `failed`가 하나라도 있으면 분모와 gap count를 응답에 남긴다.
4. 기존 `cs_history_scans.timezone_name`은 Qoo10에 `Asia/Tokyo`를 허용한다. 기존 코드의 Qoo10=`Asia/Seoul`을 그대로 두지 않는다.
5. `SECURITY DEFINER` 함수는 `set search_path=''`, revoke from `public/anon/authenticated`; admin-start만 `authenticated`, worker-record만 `service_role`에 최소 실행 권한을 준다.

`app/api/channel-gateway/worker/complete/route.ts`에서는 `job.channel==='qoo10'`, `operation==='inquiries.list'`, history metadata가 있을 때만 다음 순서로 처리한다.

```ts
const window = qoo10HistoryWindowFromArguments(jobArguments);
const assessed = assessQoo10HistoryExecution({
  window,
  execution: inquiryResult,
  observedRowLimit: observedQoo10RowLimit,
});
const children = assessed.refinement.map((child) => ({
  periodicKey: qoo10HistoryWindowKey(child),
  arguments: qoo10HistoryArguments(child),
}));
// Complete the gateway receipt first, then atomically persist coverage and enqueue
// children through sellerpilot_service_record_qoo10_history_window_v1.
// Never translate unverified/incomplete/irreducible_gap to history completion.
```

## 필수 통합 테스트

```bash
node --import tsx --test \
  tests/cs-qoo10-history-runtime.test.ts \
  tests/cs-qoo10-history-runtime-db.test.mjs \
  tests/channel-protocols.test.ts \
  tests/cs-history-window-route.test.ts \
  tests/cs-history-channel-db.test.mjs
```

추가 assertion:

- 30일 Qoo10 scheduler = 120개의 서로 다른 일별 key.
- 선택 기간의 마지막 날이 현재 시각으로 늘어나지 않는다.
- array/envelope 양쪽에서 동일 count가 나온다.
- `0 rows + provider total 5`는 mismatch이며 24개 hour child를 만든다.
- day/hour/minute/second 포화, 1초 포화의 `irreducible_gap` 보존.
- S1/S2/S3의 같은 type/question/sequence는 하나의 identity/status 이동으로 집계한다.
- 같은 sequence라도 다른 question은 합치지 않는다.
- 같은 창 재수집은 window row/job을 중복 생성하지 않는다.
- child 완료 후 parent를 완료 leaf로 세지 않는다.
- 고객 원문·주소·연락처·구매자 ID가 coverage/로그/RPC payload에 없는지 검사한다.

## 통합 상태

- 공통 반영: 미적용
- 운영 DB: 미적용
- 원격 재조회: 이 제안서 작성 중 재실행하지 않음
- 로컬 전용 구현/fixture: 완료
