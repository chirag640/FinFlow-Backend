# FinFlow Backend

FinFlow Backend is a NestJS REST API that powers authentication, expenses, budgets, groups, and sync workflows for the FinFlow platform.

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
- FCM health check: `/api/v1/health/fcm`

## Core Features

- Auth: register, login, refresh, logout, profile retrieval
- User profile management
- Expense and budget CRUD flows
- Group expenses and settlements
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
- `FIREBASE_SERVICE_ACCOUNT_JSON` (or `FIREBASE_SERVICE_ACCOUNT_BASE64`) for FCM push delivery

## JWT Secret Rotation (Baseline)

FinFlow supports a grace-window rotation model for JWT signing secrets.

- Active access secret: `JWT_SECRET`
- Previous access secret(s): `JWT_SECRET_PREVIOUS` (comma-separated)
- Active refresh secret: `JWT_REFRESH_SECRET`
- Previous refresh secret(s): `JWT_REFRESH_SECRET_PREVIOUS` (comma-separated)

Recommended rotation flow:

1. Generate a new active secret and move the old active value into the matching `*_PREVIOUS` variable.
2. Deploy backend with both active and previous values set.
3. Wait at least one full token lifetime (`JWT_EXPIRES_IN` for access, `JWT_REFRESH_EXPIRES_IN` for refresh).
4. Remove old values from `*_PREVIOUS` and deploy again.

Notes:

- Access token validation accepts current and previous access secrets.
- Refresh rotation also validates token signatures against current and previous refresh secrets before session lookup.
- Keep the grace window short and avoid storing more than a small number of previous keys.

## API Version Lifecycle Policy

FinFlow emits API lifecycle headers on versioned routes (`/api/:version/*`) to support deprecation communication and client migrations.

Environment variables:

- `API_CURRENT_VERSION` (default: `v1`)
- `API_SUPPORTED_VERSIONS` (comma-separated)
- `API_DEPRECATED_VERSIONS` (comma-separated)
- `API_SUNSET_VERSIONS` (comma-separated)
- `API_VERSION_DEPRECATION_DATE` (RFC3339 timestamp, optional)
- `API_VERSION_SUNSET_DATE` (RFC3339 timestamp, optional)
- `API_LIFECYCLE_POLICY_URL` (default: `/api/docs`)

Response headers include:

- `x-api-version`
- `x-api-current-version`
- `x-api-supported-versions`
- `x-api-lifecycle-stage` (`active`, `deprecated`, `sunset`, or `unsupported`)
- `x-api-lifecycle-policy`

For deprecated/sunset versions, the API additionally emits `Deprecation`, optional `Sunset`, and `Warning` headers.

## Push Notifications (FCM)

Backend now supports push notifications for:

- Added-to-group events
- New group expense events
- Settlement recorded events
- Daily "today's expenses" summary (runs at 9:00 PM server time)

If Firebase credentials are missing, push notifications are skipped safely and API behavior remains unchanged.

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

On this Windows setup, use `npm.cmd` for script execution in terminal commands.

## AI-Assisted Development Workflow

This workspace includes a production-focused Copilot setup for consistent backend quality.

- Main rules: `../.github/copilot-instructions.md`
- Nest instructions: `../.github/instructions/nest.instructions.md`
- Local playbooks: `../.copilot/skills/`
- VS Code automation: `../.vscode/tasks.json`, `../.vscode/settings.json`
- Setup guide: `../docs/AI_VSCODE_POWER_SETUP.md`

Use VS Code task `Validate: All` or run checks manually:

```bash
npm.cmd run build
npm.cmd run lint
```

## Troubleshooting

- If Atlas SRV DNS fails (`querySrv ECONNREFUSED`), use a non-SRV seed list URI format in `DATABASE_URL`.
- If auth errors occur after env changes, restart the server to reload `.env`.
- If deployment fails on startup, verify `start:prod` points to compiled output and `PORT` is not hardcoded.

## Related Project

- Frontend app: `../FinFlow-Frontend`
