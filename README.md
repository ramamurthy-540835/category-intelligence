# Category Intelligence

Category Intelligence is a full-stack app with a FastAPI backend and a Next.js frontend.

## Project Structure

- `frontend/`: Next.js application.
- `frontend/app/`: App Router pages and API routes.
- `frontend/components/`: Reusable frontend UI components.
- `frontend/lib/`: Frontend utilities and API helpers.
- `backend/`: FastAPI backend service.
- `backend/agents/`: Agent orchestration logic.
- `backend/tools/`: Analytics and intelligence tool modules.
- `backend/core/`: Shared backend services.
- `backend/data/`: Data clients and external feeds.
- `backend/schemas/`: API schema definitions.
- `backend/tests/`: Backend tests.
- `scripts/`: Project scripts.

## Local Development

1. Frontend install:

```bash
cd frontend
npm install
```

2. Run full stack from repo root:

```bash
bash scripts/start.sh
```

## Useful Commands

- Frontend only:

```bash
cd frontend && npm run dev
```

- Full stack:

```bash
cd frontend && npm run dev:stack
```

- Push helper:

```bash
cd frontend && npm run push:github
```
