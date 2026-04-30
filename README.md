# Category Intelligence

Category Intelligence is a full-stack app with a Next.js frontend and a FastAPI backend for retail category analysis.

## Project Structure

- `app/`: Next.js App Router pages and API routes.
- `components/`: Reusable frontend UI components.
- `lib/`: Frontend utilities, API client helpers, and metrics helpers.
- `backend/agents/`: Agent orchestration logic.
- `backend/tools/`: Analytics and intelligence tool modules.
- `backend/core/`: Shared backend services (auth, audit, metrics, PII).
- `backend/data/`: Data access clients and external feed integrations.
- `backend/schemas/`: API schema definitions.
- `backend/tests/`: Backend test suite.
- `scripts/`: Developer automation scripts.

## Local Development

1. Install frontend dependencies:

```bash
npm install
```

2. Start backend + frontend together:

```bash
npm run dev:stack
```

## Useful Scripts

- `npm run dev` - Start frontend only (port from Next defaults or flags).
- `npm run dev:stack` - Start backend on `:8001` and frontend on `:3001`.
- `npm run push:github` - Commit and push using `GITHUB_TOKEN` from `.env.local`.
