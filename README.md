# FinFlow Backend

FinFlow Backend is a NestJS REST API that powers authentication, expenses, budgets, groups, investments, and sync workflows for the FinFlow platform.

## Stack

- NestJS 10
- TypeScript
- MongoDB (native `mongodb` driver)
- JWT authentication
- Swagger (non-production)
- Throttling, validation, exception filters, interceptors

## API Basics

- Base path: `/api/v1`
- Swagger docs (non-production): `/api/docs`
- Health check: `/api/v1/health`

## Core Features

- Auth: register, login, refresh, logout, profile retrieval
- User profile management
- Expense and budget CRUD flows
- Group expenses and settlements
- Investment module endpoints
- Sync module for cloud synchronization

## Prerequisites

- Node.js 20+
- npm
- MongoDB (local, Docker, or Atlas)

## Environment Setup

1. Copy environment template:

```bash
cp .env.example .env
```

2. Fill required values in `.env`:

- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
- `RESEND_API_KEY`
- `EMAIL_FROM`

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start in development mode:

```bash
npm run start:dev
```

3. API runs at:

`http://localhost:3000/api/v1`

## Production Build and Run

1. Build:

```bash
npm run build
```

2. Run production server:

```bash
npm run start:prod
```

The app listens on `process.env.PORT` when provided, with fallback to `3000`.

## Docker MongoDB (Optional for Local Dev)

Use the included compose file to run MongoDB and Mongo Express:

```bash
docker compose up -d
```

Default Mongo Express UI:

`http://localhost:8081`

## Render Deployment Notes

Recommended service commands:

- Build command: `npm run build`
- Start command: `npm run start:prod`

Ensure these environment variables are set in Render:

- `PORT` (injected by Render automatically)
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `ENCRYPTION_KEY`
- `RESEND_API_KEY` and `EMAIL_FROM` if email flows are enabled

Health check path for Render:

`/api/v1/health`

## Useful Scripts

- `npm run build` - compile TypeScript to `dist`
- `npm run start` - run app in standard mode
- `npm run start:dev` - run with watch mode
- `npm run start:prod` - run compiled output
- `npm run lint` - lint and fix
- `npm run test` - run unit tests

## Troubleshooting

- If Atlas SRV DNS fails (`querySrv ECONNREFUSED`), use a non-SRV seed list URI format in `DATABASE_URL`.
- If auth errors occur after env changes, restart the server to reload `.env`.
- If deployment fails on startup, verify `start:prod` points to compiled output and `PORT` is not hardcoded.

## Related Project

- Frontend app: `../FinFlow-Frontend`
