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
