# SellerPilot channel gateway worker

The channel gateway is a long-running queue consumer. It claims one fenced job,
keeps that claim alive while it talks to the marketplace, and then stores a
terminal result. It must run under a persistent process supervisor. A Vercel
Function remains the authenticated web/control plane, but it is not the daemon
host because function instances have bounded lifetimes and may be recycled.

## Runtime mode

Use Node.js 22 and the dedicated gateway mode:

```sh
corepack enable
pnpm install --prod --frozen-lockfile
pnpm gateway:worker
```

`gateway:worker` is equivalent to:

```sh
node --import tsx scripts/ai-cli-worker.mjs --gateway-only
```

The container and systemd examples use that direct Node command, so the process
supervisor does not need to invoke Corepack or pnpm after dependencies are
installed.

This mode does not claim AI jobs and does not require the ChatGPT/Codex binary,
Swift OCR tools, or the local `codex-image` skill. Existing `ai:worker`,
`--ai-only`, and `--product-only` behavior is unchanged.

The ordinary cross-platform `sharp` package remains a production dependency
because listing gateway jobs normalize marketplace gallery images. That is not
an AI image generator or a macOS runtime requirement; CS-only jobs do not invoke
the normalization path.

## Required configuration

Store values in the host secret manager or a root-readable environment file.
Never bake them into an image, service file, shell history, or repository.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SELLERPILOT_URL` | Yes in production | Exact deployed SellerPilot origin, for example the production HTTPS origin. |
| `SELLERPILOT_GATEWAY_WORKER_TOKEN` | Yes | Active worker token with only the `gateway` scope. Startup fails closed when it is absent or malformed. |
| `SELLERPILOT_SCHEDULER_WORKER_TOKEN` | For automatic sync | Separate `scheduler`-scoped token used to enqueue periodic order/inquiry sync and notification work. Queue consumption still works without it. |
| `SELLERPILOT_TEMU_EGRESS_IPS` | Before any Temu job | Comma-separated allowlisted public egress IPs. Temu work fails closed when the current egress is not allowed. |
| `SELLERPILOT_CHANNEL_WORKER_CONCURRENCY` | No | Concurrent gateway jobs, clamped to 1-4; default 2. |
| `SELLERPILOT_GATEWAY_WORKER_POLL_MS` | No | Minimum idle claim interval, at least 2,000 ms; default 5,000 ms. |
| `SELLERPILOT_GATEWAY_WORKER_MAX_IDLE_POLL_MS` | No | Maximum idle backoff; default 30,000 ms. |
| `SELLERPILOT_GATEWAY_HEALTH_PORT` or `PORT` | No | Health HTTP port; default 8080. |
| `SELLERPILOT_GATEWAY_HEALTH_HOST` | No | Bind host; default `0.0.0.0`. |
| `SELLERPILOT_GATEWAY_READINESS_STALE_MS` | No | Maximum age of a successful claim API response; 60,000-3,600,000 ms, default 180,000 ms. |

Do not reuse an AI worker token for gateway access. The server-side gateway
claim RPC returns marketplace credentials only to an active gateway-scoped
token.

## Health contract

- `GET /healthz` is liveness. It returns HTTP 200 while the process is alive,
  including while it is draining after `SIGTERM`.
- `GET /readyz` is readiness. It returns HTTP 200 only after the worker has
  successfully contacted the gateway claim endpoint with a 2xx response and
  that contact is still fresh. Missing/invalid gateway credentials, HTTP 401,
  API failure, stale contact, and shutdown return HTTP 503.
- Health JSON exposes mode, version, configured scope booleans, timestamps, and
  active-job count. It never exposes tokens or marketplace credentials.

The scheduler token is reported separately. A worker can be ready to consume
already-enqueued CS replies without it, but automatic historical/order/inquiry
sync is unavailable until the scheduler scope is configured.

## Deployment options

Use either:

- `deploy/channel-gateway-worker.Dockerfile` on a persistent container/worker
  service with restart policy, or
- `deploy/sellerpilot-channel-gateway-worker.service.example` on a Node 22
  host managed by systemd.

The host needs stable outbound HTTPS. Temu also needs a stable public egress IP
that exactly matches its developer-console allowlist. Keep at least one replica
running continuously; database claim tokens and leases allow multiple gateway
consumers, but designate only one replica for periodic scheduling when possible.

Example checks after deployment:

```sh
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

`--once` is available for a bounded smoke test (`pnpm gateway:worker:once`). It
does not replace the supervised long-running process.

## Production release gate

Code availability is not the same as an operating worker. Do not report remote
CS as complete until all of these are independently verified:

1. The exact production Supabase project is linked and all pending gateway/eBay
   migrations, including
   `20260828141000_enable_ebay_asq_inquiry_reply_lineage.sql`, are applied there.
2. Fresh, separately scoped gateway and scheduler tokens are issued by that
   production project and injected through the host secret manager.
3. The persistent process reports both `/healthz` and `/readyz` healthy after a
   restart and remains healthy under the supervisor.
4. Provider Vault credentials, OAuth state, provider permissions, callback
   origins, and outbound IP allowlists are verified for the same environment.
5. A non-customer sandbox/read operation is claimed, heartbeated, completed,
   and visible in the production ledger without a reconciliation fence.
6. Each channel's actual reply capability is verified separately. A read-only
   integration is not a reply integration. eBay ASQ production remains gated
   until its provider lineage/release verification passes.

If the database project, worker-token issuance, persistent host, provider
permission, or stable egress is unavailable, the corresponding production
outcome remains blocked even though the runtime code and local tests pass.
