# SA7 Smart Energy Automation

SA7 helps a household inspect virtual appliance usage, find measurable energy waste, and test rule-based shutoffs with a realistic simulator.

## Run & operate

- The Replit workflows `artifacts/smart-energy: web` and `artifacts/api-server: API Server` serve the UI at `/` and the REST API at `/api`.
- `pnpm install` installs the workspace packages.
- `pnpm run typecheck` checks the TypeScript workspace.
- `pnpm --filter @workspace/db run push` applies development database schema changes.
- `pnpm --filter @workspace/api-spec run codegen` regenerates Zod schemas and React Query hooks after OpenAPI changes.
- Server environment: `DATABASE_URL`, `SESSION_SECRET`, and `GEMINI_API_KEY`. Keep credentials in Replit Secrets; never put them in client code or commit them.

## Product and boundaries

- Email/password accounts, PostgreSQL-backed sessions, and per-user records.
- Dashboard, device inventory, telemetry CRUD, editable INR/kWh tariff, automation rules/action history, measured waste events, and on-demand Gemini analysis.
- Virtual devices are the data source. The simulator creates telemetry and evaluates actual server-side automation rules; it does not control physical appliances.
- Keep all UI and API costs in INR. Do not add chat, billing, IoT provisioning, or unrelated modules without an explicit request.
- Gemini calls and credential handling stay on the API server. Analysis must use the signed-in user's records and validate structured model output.

## Source of truth

- `lib/api-spec/openapi.yaml` — REST contract and generated client/schema inputs.
- `lib/db/src/schema/` — PostgreSQL/Drizzle schema.
- `artifacts/api-server/src/` — API, auth, simulator, automation and analysis.
- `artifacts/smart-energy/src/` — React application.
- Root `README.md` — setup, API inventory, security, simulator, and deployment notes.

## Architecture decisions

- Keep OpenAPI-first: change the contract, run code generation, then use the generated hooks and Zod schemas.
- Use a per-user PostgreSQL tariff as the sole pricing setting; calculate costs through the shared server helper.
- Store only a digest of each opaque session token in PostgreSQL; the signed session cookie is HTTP-only and same-site.
- Seed new accounts with labeled virtual-device telemetry so the demo is usable immediately.
