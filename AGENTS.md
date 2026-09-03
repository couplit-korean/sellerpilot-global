<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Browser profile routing

- Shopping seller/admin, logistics, and marketplace developer-center work must use the Chrome profile signed in as `k931103@gmail.com` (`profileName: CHANGHEE`).
- Vercel and Supabase browser work must use the Couplit official Chrome profile signed in as `couplit.official@gmail.com` (`profileName: JEONGHUN`).
- Before any profile-specific browser action, list the available Chrome profiles read-only and verify the selected profile. Never fall back to the current/default Chrome profile.
- Do not use whole-app computer control for profile-specific browser work. Use the Chrome-specific browser controller so the selected profile remains explicit.

# Docs closeout

작업이 끝나면 `docs/현재상태.md`를 고치고, 다른 `.md`가 모순되면 맞춘 뒤 `integration-aside`에 커밋·푸시한다. 비밀 원문은 넣지 않는다.

# Git remotes

- `origin` = `Kimchanghee/sellerpilot-global` (이 환경에서 push 가능)
- `couplit` = `couplit-korean/sellerpilot-global` (Vercel Git 연결 대상일 수 있음, 이 Mac push 403)
- 유료 Vercel Static IP는 쓰지 않는다. 채널 화이트리스트에 관측 IP를 등록한다.

