# Server Structure

- `index.js` loads configuration, creates Express and Socket.IO, installs shared authentication middleware, registers routes, and starts MongoDB and the HTTP server.
- `models.js` defines MongoDB schemas and indexes.
- `routing.js` provides road-routing with a straight-line fallback.
- `routes/auth.js` handles admin, staff, and commuter authentication and profile sessions.
- `routes/admin.js` handles admin-managed mobile accounts and agent/distributor profiles.
- `routes/inboxes.js` handles agent, distributor, and Superagent messages and deletion requests.
- `routes/network.js` handles agent/distributor profiles, locations, telemetry, support, and float settlements.
- `routes/dispatch.js` handles SOS assignment, distributor matching, dispatch completion, and task messages.
- `routes/analytics.js` handles transaction, liquidity, summary, and operations reports.
- `seed.js` seeds local development data.

Route modules export a registration function and receive shared models, middleware, services, and Express/Socket.IO instances from `index.js`. Keep route paths and middleware order stable when adding endpoints.

Start the API from the repository root with `npm run dev:api` or `npm start`.
