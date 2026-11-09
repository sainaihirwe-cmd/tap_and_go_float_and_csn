# Tap & Go Network Operations

A React/Vite administration dashboard in `frontend/` and Expo React Native mobile app in `mobile/`, backed by a Node.js/Express API in `server/`, MongoDB geospatial indexes, and Socket.IO live events.

## Run locally

Requirements: Node.js 20 or newer, Docker, and MongoDB. Dispatch, ticket-sale recording, and replenishment use MongoDB transactions, so MongoDB must run as a replica set. The included Compose file provides a single-node local replica set:

```sh
npm install
docker compose up -d --wait mongo
mongosh "mongodb://127.0.0.1:27017/admin" --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'
npm run seed
npm run dev
```

Backend settings live in `server/.env`; the Vite proxy setting lives in `frontend/.env`. Both files are excluded from version control, with templates in `server/.env.example` and `frontend/.env.example`. For a fresh checkout, create them with:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item frontend/.env.example frontend/.env
```

Set `VITE_API_PROXY_TARGET` to the backend origin used by Vite during development; the browser continues to call same-origin `/api` and `/socket.io` routes through that proxy. The `VITE_` prefix is for frontend-safe configuration only; never put secrets in `VITE_` variables. For physical mobile devices, configure `EXPO_PUBLIC_API_URL` in `mobile/.env` separately.

Open the web dashboard at `http://localhost:5173` (Vite automatically selects the next available port if 5173 is occupied; use the URL printed in the terminal). Vite proxies API and Socket.IO traffic to the configured backend. From the project root, `npm run dev` starts only the backend API; use a second terminal and run `npm run dev:web` to start the frontend. To start both together, run `npm run dev:stack`. When starting the frontend from `frontend/`, `npm run dev` starts only Vite and the API must already be running separately with `npm run dev:api` from the root. The seed command creates representative London agents, distributors, ticket activity, and low-float alerts. It is safe to rerun and does not overwrite existing agent balances or distributor status.

The admin web **Commuter map** can run a nearby-agent search using the browser’s location permission. It requests location only after **Find agents near me** is clicked, searches within 500 m, and shows agent positions, distance, and high/medium/low float availability colors without exposing exact balances. After a search, colored counters show how many of the displayed agents fall into each availability level; if there are more than 100 matches, the map shows the nearest 100 and labels those counter totals accordingly. Selecting an agent opens Google Maps directions in a new tab.

The admin dashboard requires a sign-in. For local development, the default credentials are `admin@tapandgo.local` / `TapGoDev2026!`; configure these with `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`. Admin sessions use an eight-hour HttpOnly cookie. The dashboard displays a live countdown and automatically signs out when the session expires; sign in again to continue. Protected API routes continue to enforce administrator authentication and session authorization. Set a unique `AUTH_SECRET` and strong admin password before deployment; production mode refuses to start without all three values.

Use **Settings** in the dashboard sidebar to update the administrator name, sign-in email, or password. Profile changes are stored in MongoDB; the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` initialize the profile on its first successful sign-in. Confirm the current password for every profile update, and choose a new password of at least 12 characters. Saving changes signs out other active sessions.

## Mobile apps

The `mobile/` Expo project includes Commuter, Agent, and Distributor modes. On the same Wi-Fi, the app automatically uses the Expo development server's host address for its API connection. If using Expo Tunnel or a standalone build, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the computer's LAN IP and port 3000 (never `localhost` on a physical phone). Ensure Windows Firewall allows incoming connections to Node.js. Then run:

```sh
cd mobile
copy .env.example .env
npm install
npm start
```

Agent and Distributor dashboards require an email and password. Administrators create and disable these linked accounts in **Settings → Agent & distributor logins**; there is no mobile self-registration. Each account is linked to one existing Agent or Distributor profile, and mobile API access is limited to that linked record and (for distributors) their own assignments. Agent and Distributor profile forms do not ask for coordinates; location is recorded automatically when the user enables GPS sharing in the mobile app. Distributors start off duty; tapping **Go on duty & share GPS** gets and posts a fresh GPS fix before marking them available, records the shift start time, and immediately notifies the administrator dashboard. Background location updates continue while on duty, and **Refresh GPS now** can send a fresh fix manually. The distributor list shows when the current or most recent shift started. Until a recent GPS location is available, the profile cannot be selected for location-based dispatches. In the Agent dashboard, enter the ticket sale amount and tap **Record ticket sale**; the amount is deducted from the available float and the displayed balance updates. Sales larger than the available float are rejected, and low balances trigger an SOS alert. The sale is recorded in the ledger and contributes to the rolling 30-day commuter-sales total in the administrator directory. In MongoDB, the same salted password hash is stored in `mobile_accounts.passwordHash` and the linked `agents.passwordHash` or `distributors.passwordHash` field whenever an account is created or its password is set/reset. On backend startup, missing profile hashes are backfilled from valid linked mobile-account hashes. Hashes are excluded from normal profile queries and API responses; original passwords are not recoverable. If a linked login has no valid hash, reset its password in the admin dashboard. Mobile session tokens are kept in platform secure storage. The app opens on commuter account creation, with commuter sign-in and a separate **Agent or Distributor sign in** path; staff accounts remain administrator-provisioned. Agent and Distributor dashboards separate **Home** and **Messages**, and their account header provides Settings and Sign out. Users can edit their own name, phone number, and area, and update their sign-in email or password in Settings. Credential changes require the current password, new passwords must be at least 12 characters, and other active sessions are revoked. Distributors can message network operations from their inbox. Agents can request float support with their current GPS location; the request appears in the admin inbox and dispatch board. The agent cannot select or assign a distributor: an administrator reviews each request, selects an eligible nearby distributor, and sends the transfer task.

The mobile app offers English, Kinyarwanda, and French for Commuter, Agent, and Distributor screens; Kinyarwanda is the default and the selection is remembered. The language control appears on the default Commuter menu; tap it to choose a language, and the choice updates every mobile role screen. Return to Commuter to change languages. In Commuter mode, tap **Shaka abakozi bakora hafi yanjye** (or **Find active agents near me** in English) and allow location access to search within 500 m. The dashboard shows the total number found and each nearby agent’s availability color; if more than 100 match, it lists the 100 nearest and reports the full count. Results include agents whose location was updated in the last 15 minutes and who have float remaining; tap a result for map directions. The map pins and agent cards use the same float color band, never exact balances: green means above twice the safe threshold, yellow means above the threshold but at or below twice it, and red means at or below the safe threshold. The agent directory remains administrator-only and shows exact GBP balances. Its sort options include highest/lowest float and most recorded ticket-sale value over the past 30 days.

Background GPS requires an iOS/Android development or production build; Expo Go does not support background location. Configure `GOOGLE_MAPS_API_KEY` for Android release builds. Users must grant location permission. Mobile operating systems may pause or stop background updates when the user force-quits the app. The development config permits local HTTP API traffic; use HTTPS and disable cleartext traffic for production builds.

To start the mobile development server from the root, run `npm run dev:mobile` in a second terminal.

## Production-style web run

```sh
npm run build
npm start
```

Open `http://localhost:3000`. Express serves the compiled React app and API. MongoDB 2dsphere indexes are created for agents, distributors, and alerts on server startup. The API retries transient MongoDB connection failures with increasing delays and starts listening after the database is available. Configure `MONGODB_URI`, `SOS_THRESHOLD_GBP`, and `WEB_ORIGIN` in `server/.env`. `WEB_ORIGIN` is a comma-separated allowlist. Set `ROUTING_BASE_URL` to an OSRM-compatible routing service to attach road geometry and travel-time estimates to dispatches. Without it, dispatch matching still selects the closest available distributor by indexed geodesic distance and stores a straight-line route fallback.

## API overview

All locations use GeoJSON Point coordinates in `[longitude, latitude]` order.

If dispatch matching finds no eligible distributor because active profiles are off duty or their GPS is missing or stale, the admin assignment dialog can send them a persistent Distributor inbox message asking them to go on duty and refresh GPS. This is only a request; assignment still requires a fresh location within 500 m.

Commuters create an account in the mobile app and then see the live agent map centered on their current location, with active agents limited to 500 m and map marker colors indicating float availability. The map does not reveal exact agent float balances. Agent and Distributor accounts are not self-service: administrators provision their mobile login credentials and users can only sign in with those accounts. The Agent directory includes tracked shift hours; hours begin when an agent goes on duty and accumulate when they end the shift.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database health |
| GET | `/api/auth/me` | Current signed-in administrator profile |
| PATCH | `/api/auth/profile` | Update administrator name, email, or password |
| POST | `/api/auth/mobile/login` | Sign in to an administrator-provisioned Agent or Distributor account |
| GET | `/api/auth/mobile/me` | Current mobile account and its linked profile (bearer token required) |
| POST | `/api/auth/commuter/register` | Create a commuter account with a name, email, and 12+ character password |
| POST | `/api/auth/commuter/login` | Sign in to a commuter account |
| GET, POST | `/api/admin/mobile-accounts` | List or provision mobile accounts (administrator session required) |
| PATCH | `/api/admin/mobile-accounts/:id` | Enable or disable a mobile account and revoke its sessions |
| POST | `/api/admin/agents` | Create an agent profile and linked mobile login atomically; optional opening float is recorded in the ledger |
| POST | `/api/admin/distributors` | Create a distributor profile and linked mobile login atomically |
| PATCH | `/api/admin/:role/:id` | Update an agent or distributor profile and login email; an optional new password revokes existing sessions |
| PATCH | `/api/admin/:role/:id/archive` | Archive or restore a profile (`archived: true/false`); archiving disables mobile login and retains financial history |
| GET, POST | `/api/agents` | List or register agents |
| PATCH | `/api/agents/:id/profile` | Update an agent's name, phone, or area |
| POST | `/api/agents/:id/telemetry` | Update agent GPS and check the stored float for a low-float SOS (mobile bearer token required); submitted balances are ignored |
| POST | `/api/agents/:id/ticket-sales` | Atomically record a commuter ticket sale and deduct agent float; at or below the higher of £10,000, 10% of the current replenishment target, or the configured safe threshold, automatically mark the agent at risk and send an SOS float-transfer alert to admins (mobile bearer token required) |
| POST | `/api/agents/:id/support` | Send a location-tagged float-support request to operations (mobile bearer token required) |
| GET | `/api/agents/:id/float-settlements` | Agent's recent settlement reports (agent token required) |
| POST | `/api/agents/:id/float-settlements` | Submit an end-of-day bank-slip report with a JPEG, PNG, or WebP proof image (maximum 2 MB; agent token required) |
| GET | `/api/float-settlements` | Admin settlement queue and history |
| GET | `/api/float-settlements/:id/bank-slip` | View bank-slip proof (administrator session required) |
| PATCH | `/api/float-settlements/:id` | Approve a verified deposit to credit float, or reject with a reason (administrator session required) |
| PATCH | `/api/agents/:id/status` | Set agent availability |
| GET | `/api/commuter/nearby?longitude=…&latitude=…` | Nearby agents with a GPS update in the last 15 minutes, public float band only, and commuter search log |
| GET, POST | `/api/distributors` | List or register distributors |
| PATCH | `/api/distributors/:id/profile` | Update a distributor's name, phone, or area |
| PATCH | `/api/distributors/:id/location` | Distributor GPS telemetry |
| PATCH | `/api/distributors/:id/status` | Go on duty or safely end a shift |
| GET | `/api/distributors/:id/tasks` | Active tasks for a distributor |
| GET | `/api/alerts?state=open` | GPS-tagged liquidity alerts |
| GET | `/api/agent-messages` | Admin inbox of agent support messages and low-float alerts, including resolved history |
| GET | `/api/admin/distributor-inbox` | Admin inbox conversations for distributors with active mobile logins |
| POST | `/api/admin/distributor-inbox/:distributorId/messages` | Send a direct message to an active distributor |
| GET, POST | `/api/distributor-inbox` | Distributor's own direct inbox; POST accepts a message of up to 500 characters |
| GET | `/api/dispatch-options?agentId=…` or `?alertId=…` | Find available distributors within 500 m, preferring the agent's zone and ranking by route ETA |
| POST | `/api/alerts/:id/dispatch` | Assign a selected or best-matched available distributor; optional `instructions` are sent with the task |
| POST | `/api/admin/agents/:id/dispatch` | Create or reuse an agent support alert and assign a selected or best-matched distributor |
| GET | `/api/dispatches` | Active assignments; `?status=completed` returns the 50 most recent completed top-ups with delivered amount and resulting POS balance |
| PATCH | `/api/dispatches/:id` | Assigned distributor updates task status or completes it with the amount delivered (credits the agent POS float) |
| POST | `/api/dispatches/:id/messages` | Send a message in an active dispatch conversation (admin or assigned distributor) |
| GET | `/api/transactions?hours=24` | Recent ticket and float transactions |
| GET | `/api/liquidity/heatmap?hours=24` | Agent liquidity and activity points |
| GET | `/api/summary` | Network KPIs |
| GET | `/api/analytics?days=7` | Alert, dispatch, replenishment, and zone analytics |

Socket.IO broadcasts agent telemetry, SOS alerts, distributor positions, and dispatch events to administrators; each new dispatch is also sent privately to the assigned distributor's active mobile login. Distributor assignment is administrator-controlled: agent support and low-float alerts remain open until an admin selects a distributor. No background process automatically assigns queued alerts. The dispatch dialog fetches selectable nearby distributors for the chosen agent, using the agent's latest GPS position instead of a potentially stale SOS location. Matches must be on duty, have an active mobile login, and have GPS updated within 15 minutes; candidates are limited to 500 m, with same-zone matches prioritized and road-route travel time used when configured. If an on-duty distributor has stale GPS, the admin search requests a fresh location from the distributor app and retries matching for up to 10 seconds; the distributor can also use **Refresh GPS now**. If no match exists, the admin dialog reports counts for active logins, on-duty distributors, recent GPS updates, and candidates within range. The assignment rechecks availability, distance, and GPS freshness before committing, so an unavailable selection can be refreshed without creating a partial task. Administrators can edit the prefilled urgent float-transfer message (up to 500 characters); it is delivered immediately with the task and shown in the distributor's mobile app alongside directions and agent details. Admins and assigned distributors can reply in the dispatch conversation; messages are stored with the dispatch and delivered live to the other party. The separate **Distributor inbox** lets administrators and distributors message each other outside a dispatch; conversations are retained in MongoDB (latest 200 messages per distributor), delivered live, and limited to 500 characters per message. MongoDB stores agents, alerts, distributors, commuter logs, operational events, dispatches, distributor inboxes, settlement reports, and transactions.

Administrators can manage agent and distributor profiles from their respective dashboard sections. Agent zones can be selected from zones already in use or entered as a new zone in the profile form. Archiving is non-destructive: it hides the profile from normal lists, disables its linked mobile login, closes any queued agent SOS alerts, and retains historical records. Restoring a profile does not automatically re-enable its login. Creating or archiving a profile together with its linked records requires MongoDB transaction support.

For urgent float support, an administrator can open **Agent directory** and choose **Assign distributor** on the agent’s row, or choose **Choose & assign** from an open alert. The dialog lists eligible distributors near the agent; assignment remains administrator-controlled and requires the configured 500 m range, recent distributor GPS, an active login, and on-duty status. The distributor sees the task and transfer instructions in the mobile app. After delivering float, the distributor enters the amount actually handed over and taps **Complete top-up**; the backend atomically records that amount and the resulting POS float, credits the agent, and immediately updates the admin dashboard. Completed amounts and post-top-up POS balances remain visible under **Recent completed top-ups** on the Dispatch page.

Agent float is ledger-based: recorded ticket sales decrease it, and completing a distributor-assigned replenishment records a top-up and increases it. Agents can submit an end-of-day bank settlement with a bank reference and photo; reported float use is calculated from recorded ticket sales. Only an administrator can verify the slip and approve a credit, and that approval atomically records the float top-up and its audit event. The credit cannot exceed the stated bank deposit. A pending report blocks duplicate submissions, and a rejection requires a reason. Low-float ticket sales automatically raise an SOS; agents can also send operations a support message for urgent float or other problems. Agent GPS telemetry cannot change the balance. Agent telemetry/profile/status, distributor location/profile/status/tasks, and dispatch completion require a valid role-specific mobile bearer token and are restricted to the linked account. The agent/distributor directory endpoints remain administrator-only; public commuter discovery is separate. Socket.IO connections require an administrator cookie or mobile token; network-wide events are delivered only to administrators. Configure authentication, authorization, TLS, privacy retention, and trusted origins before exposing the API to agent devices or the public internet. Background location is subject to iOS and Android permission, battery, and process-lifecycle limits.
Superagent accounts are created by an administrator in **Settings → Agent, distributor & Superagent logins**, where the administrator assigns each account its own agents. A Superagent can create and edit assigned Agent profiles and view their POS float, but only an administrator can create the Agent login/POS account or arrange float. Requesting agent deletion requires a reason and does not immediately remove the agent. The request appears in the admin’s **Superagent deletion requests** queue; only admin approval archives the agent and disables its login. If the admin rejects the request, a rejection reason is required and is shown to the requesting Superagent.
