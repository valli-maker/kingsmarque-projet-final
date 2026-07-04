# Kingsmarque — Title Intelligence

Project skeleton. No features yet — features land as numbered tasks.

## Structure
See "Folder structure" in the task log / below.

```
backend/    FastAPI · SQLAlchemy(async) · Alembic · Ruff · pytest
frontend/   React · TypeScript · Vite · Tailwind · shadcn/ui · ESLint · Prettier
```

## Develop
```bash
# backend  (Python 3.12)
cd backend && pip install -e ".[dev]"
uvicorn app.main:app --reload          # http://localhost:8000/api/v1/health
pytest && ruff check . && ruff format --check .

# frontend (Node 22)
cd frontend && npm install
npm run dev                            # http://localhost:5173 (proxies /api)
npm run build && npm run lint && npm run format:check
```

## Full stack
```bash
cp .env.example .env   # edit values
docker compose up --build
```
