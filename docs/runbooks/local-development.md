# Local development

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a local PostgreSQL database.
2. Run `pnpm install`, then `pnpm db:migrate`.
3. Start API, worker, vault, and web with `pnpm dev`.
4. Keep supplier webhook secrets and vault keys outside source control. Use opaque traveler references only.

Useful checks: `pnpm typecheck`, `pnpm test`, and `pnpm security:scan-sensitive-output`.
