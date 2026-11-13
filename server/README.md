# Server Structure

- `index.js` loads configuration, creates Express and Socket.IO, installs shared authentication middleware, registers routes, and starts MongoDB and the HTTP server.
- `models/` defines MongoDB schemas and indexes by domain. `models/index.js` exports the complete model set; `models.js` remains a compatibility entry point.
- `controllers/` contains the request handlers for authentication, administration, inboxes, network operations, dispatch, and analytics.
- `routes/` keeps the existing route-module entry points and forwards them to the matching controller modules.
- `routing.js` provides road-routing with a straight-line fallback.
- `seed.js` seeds local development data.

Controller modules export a registration function and receive shared models, middleware, services, and Express/Socket.IO instances from `index.js`. Keep route paths and middleware order stable when adding endpoints.

Start the API from the repository root with `npm run dev:api` or `npm start`.
