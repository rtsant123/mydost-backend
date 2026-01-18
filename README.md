# mydost-backend

Production-ready backend for **mydost** with a Fastify API, Postgres (Prisma), Redis, and a background worker. It is built as a TypeScript monorepo and designed for Railway deployments (API + Worker + Postgres + Redis).

## Architecture

```
apps/
  api/       # Fastify REST API + SSE chat streaming
  worker/    # Cron-based background jobs
packages/
  shared/    # Types, validators, prompts
  db/        # Prisma schema + client
```

Core modules supported:
- Sports match previews + post-match recaps (Cricket + Football)
- Teer results + historical summaries (no Kolkata)
- Astrology chat (entertainment-only)
- User auth + preferences + plans/usage limits
- Voting/Confidence crowd signal
- Cache-first + RAG-ready foundations

## Local development

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set environment variables**
   ```bash
   cp .env.example .env
   ```

3. **Generate Prisma client**
   ```bash
   npm run prisma:generate
   ```

4. **Run migrations**
   ```bash
   npm run prisma:migrate
   ```

5. **Run API + Worker**
   ```bash
   npm run dev
   npm run dev:worker
   ```

## Railway deployment

Create two Railway services: **API** and **Worker**, plus **Postgres** and **Redis**.

1. **Postgres**: create a Railway Postgres instance and set `DATABASE_URL` on both services.
2. **Redis**: create a Railway Redis instance and set `REDIS_URL` on both services.
3. **API service**: set `PORT`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS`, and optionally `CLAUDE_API_KEY` and `RAZORPAY_WEBHOOK_SECRET`.
4. **Worker service**: set `DATABASE_URL` and `REDIS_URL`.
5. **Deploy** the repo. Railway will build and start the API and Worker services independently.

### Railway cron jobs
The worker uses cron schedules internally:
- `0 */8 * * *`: refresh match briefs
- `0 */6 * * *`: refresh teer summaries
- `15 * * * *`: generate match recaps

## Environment variables

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (ID token validation) |
| `ADMIN_EMAILS` | Comma-separated admin emails |
| `CLAUDE_API_KEY` | Claude API key (optional) |
| `SERPER_API_KEY` | Serper API key for web search snippets (optional but required for sports RAG) |
| `SPORTSDB_API_KEY` | TheSportsDB API key for fixtures/results sync (required for match feed) |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook secret (optional) |
| `RATE_LIMIT_TOKENS_PER_MINUTE` | Per-user token bucket refill rate |
| `RATE_LIMIT_BUCKET_SIZE` | Per-user token bucket size |

## API overview

- **Auth/User**
  - `POST /api/auth/google`
  - `GET /api/me`
  - `POST /api/prefs`

- **Plans/Usage**
  - `GET /api/usage/today`
  - `POST /api/webhooks/razorpay`

- **Matches**
  - `GET /api/matches?sport=&status=`
  - `GET /api/matches/:id`
  - `POST /api/matches` (admin)
  - `POST /api/matches/:id/refresh-brief` (admin)
  - `POST /api/matches/:id/refresh-recap` (admin)

- **Votes**
  - `POST /api/matches/:id/vote`
  - `GET /api/matches/:id/votes`

- **Teer**
  - `GET /api/teer/:house/latest`
  - `GET /api/teer/:house/history?days=30`
  - `GET /api/teer/:house/summary?days=30`

- **Chat (SSE)**
  - `POST /api/chat/start`
  - `POST /api/chat/message`

## Cache keys (Redis)

- `match:brief:{match_id}:current`
- `match:brief:{match_id}:v{version}`
- `match:recap:{match_id}:current`
- `vote:agg:{match_id}`
- `teer:latest:{house}`
- `teer:summary:{house}:{window_days}`
- `user:prefs:{user_id}`
- `rate:{user_id}`
- `usage:{user_id}:{YYYYMMDD}`

## How caching works

The API is cache-first. It reads from Redis for match briefs/recaps, vote aggregates, and teer summaries before hitting the database. The worker refreshes cache keys on a schedule, and admin endpoints can manually refresh brief/recap entries.

## RAG-ready design

The API uses a provider interface for retrieval (`SearchProvider`). It currently returns no snippets (cache-first), but is designed to swap in full-text search or pgvector-based retrieval later.
