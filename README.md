# SA7 Smart Energy Automation

SA7 is a full-stack household energy monitoring and automation demo. It gives each account a live-looking dashboard, editable virtual appliances, energy telemetry, measured waste alerts, rule-based shutoff automation, and a backend-only Gemini analysis of that account's recorded data. All money values are in Indian rupees (INR).

## What it does

- Create an account or sign in with email and password. New accounts start with sample virtual devices and labeled simulated telemetry.
- Review current device load, today's and this month's usage, estimated cost, waste events, and automation impact.
- Add, edit, deactivate, switch, or delete virtual devices.
- Add, edit, inspect, and delete energy usage records. Simulator-created rows are labeled as simulated.
- Set a per-account electricity tariff in INR/kWh.
- Create, edit, enable/disable, and delete runtime or energy-threshold rules that can actually switch an active virtual device off.
- Review automation action history and resolve, dismiss, or reopen measured waste events.
- Request a structured Gemini analysis using the signed-in account's recent usage, device runtime patterns, tariff, and open waste events.

This project simulates appliance telemetry. It does not connect to or control physical IoT devices.

## Workspace

- `artifacts/smart-energy` — React + Vite user interface.
- `artifacts/api-server` — Express REST API, authentication, simulator, rule engine, and Gemini integration.
- `lib/api-spec/openapi.yaml` — source API contract.
- `lib/api-client-react` and `lib/api-zod` — generated client hooks and validation schemas.
- `lib/db/src/schema` — PostgreSQL schema managed by Drizzle.

The browser calls the same-origin `/api` routes. API request and response shapes are defined in OpenAPI; the web app uses generated React Query hooks for those calls.

## Run in Replit

The project has two configured workflows:

- `artifacts/smart-energy: web` — web preview at `/`.
- `artifacts/api-server: API Server` — API at `/api`.

The workspace database is provided through `DATABASE_URL`. Keep these server values in Replit Secrets:

- `SESSION_SECRET` — signs the HTTP-only session cookie.
- `GEMINI_API_KEY` — used only by the API server when a signed-in user requests analysis.

Do not put either value in frontend code, API responses, logs, or committed files. Gemini analysis is an on-demand feature; it does not run in the background.

## Run from a local workspace

Use Node.js 24 and pnpm:

```sh
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/smart-energy run dev
```

Set `DATABASE_URL`, `SESSION_SECRET`, and `GEMINI_API_KEY` in the server environment before starting the API. For a local preview, run the web and API commands in separate terminals and configure the web development proxy as needed.

To check TypeScript:

```sh
pnpm run typecheck
```

After changing the API contract:

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck:libs
```

After changing the database schema, apply it to the development database with:

```sh
pnpm --filter @workspace/db run push
```

Do not use the development schema-push command against production.

## REST API

All protected routes require the signed-in session cookie.

| Area | Routes |
| --- | --- |
| Health | `GET /api/healthz` |
| Authentication | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Devices | `GET/POST /api/devices`, `GET/PATCH/DELETE /api/devices/:id` |
| Usage | `GET/POST /api/usage`, `GET/PATCH/DELETE /api/usage/:id` |
| Automation rules | `GET/POST /api/automation-rules`, `PATCH/DELETE /api/automation-rules/:id`, `PATCH /api/automation-rules/:id/enabled` |
| Waste | `GET /api/waste-events`, `GET/PATCH /api/waste-events/:id` |
| Action history | `GET /api/automation-actions` |
| Dashboard and tariff | `GET /api/dashboard`, `GET/PATCH /api/settings/tariff` |
| Simulator and analysis | `POST /api/simulation/run`, `POST /api/ai/analysis` |

Detailed request and response schemas are in `lib/api-spec/openapi.yaml`.

## Simulator and calculations

The simulator records interval energy for active virtual devices that are on. Power rating, interval length, and a device-type duty factor determine the interval usage. It then:

1. Stores the telemetry with the account's current tariff and a `simulated` marker.
2. Checks preferred runtime, the device's energy threshold, and recent per-device usage for a measurable spike.
3. Creates a deduplicated waste event when there is a positive estimated excess.
4. Evaluates enabled rules and updates device state plus an action record when a trigger is met.

The default demo tariff is ₹8.20/kWh. The tariff is stored once per account; changing it reprices stored usage, waste, automation savings, and prior analysis estimates. Savings estimates use measured kWh and the same server-side cost helper.

## Security and data isolation

- Passwords are stored as salted scrypt hashes; plain-text passwords are never persisted.
- Session tokens are opaque, signed, HTTP-only, same-site cookies. The database stores a SHA-256 digest of the token and an expiration.
- Device, usage, rule, waste, action, setting, and analysis queries are scoped to the authenticated account.
- Request bodies and API responses are validated against generated schemas. Unknown failures return generic responses; server logs avoid request secrets and model output.
- The Gemini key is read only on the server. The model returns JSON that is validated and bounded against the user's measured open waste before persistence.

## Publish checklist

Before publishing, configure the production PostgreSQL connection, a strong `SESSION_SECRET`, and `GEMINI_API_KEY` in the deployment's secret settings. Apply the production database schema through the project's approved migration process, then publish the web app and API together and verify registration, login, a simulator run, and an analysis request in the published environment.

Production secrets and production database schema are separate from their development counterparts. Never copy secret values into this README or source control.
