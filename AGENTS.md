<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Browser profile routing

## Aside 작업 — 2026-09-05 사용자 지침

- 사용자는 Aside 안에 필요한 사이트 로그인을 완료했으며, **Aside에서는 Chrome 프로필을 구분하거나 전환하지 말고 현재 Aside의 사이트별 로그인 세션으로 작업**하라고 명시했다.
- Aside에서 작업할 때 아래 Chrome 전용 규칙을 적용해 CHANGHEE/JEONGHUN 프로필 선택을 요구하거나 작업을 중단하지 않는다. 사용 중인 사이트의 판매자·팀·프로젝트가 작업 대상인지만 화면에서 확인한다.
- 로그인 완료 사실은 사용자 확인이다. 실제 세션 만료·인증 화면이 나타난 사이트만 필요한 인증을 요청하고, 다른 준비된 작업은 계속한다. 프로필 통합을 이유로 로그아웃·연결 해제·OAuth 재인가를 반복하지 않는다.
- 이 예외는 브라우저 프로필 선택에 관한 것이다. Git 저장소, Vercel 팀, Supabase 프로젝트, 마켓 판매자 식별은 유지한다.
- Aside 시작 문서: `docs/Aside-작업인계-20260905.md`, 복사할 시작 지시문: `docs/Aside-시작프롬프트.md`.

## Aside 이외의 Chrome 작업

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
