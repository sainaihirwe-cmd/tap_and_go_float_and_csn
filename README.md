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

The admin **Commuter map** uses OpenStreetMap tiles and opens centered on Kigali; the map recenters on the browser’s current location only after **Find agents near me** is clicked. It searches for active agents within 500 m and displays their locations as colored, selectable map markers; the marker popup shows the agent name, area, float availability band, and distance without exposing exact balances. The map shows a 500 m search radius and the user’s location. If there are more than 100 matches, it shows the nearest 100. Commuter activity is shown only as aggregate counts; individual commuter locations are not exposed.

The admin dashboard requires a sign-in. For local development, the default credentials are `admin@tapandgo.local` / `TapGoDev2026!`; configure these with `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`. Admin sessions use an eight-hour HttpOnly cookie. The dashboard displays a live countdown and automatically signs out when the session expires; sign in again to continue. Protected API routes continue to enforce administrator authentication and session authorization. Set a unique `AUTH_SECRET` and strong admin password before deployment; production mode refuses to start without all three values.

When an administrator creates an Agent, Distributor, or Superagent login, the account receives an email with its login address and a one-time link to choose a password. Configure `RESEND_API_KEY` and a Resend-verified `EMAIL_FROM` address in the backend environment; `FRONTEND_URL` is used to build the setup link. Setup links expire after 24 hours and can be resent from **Settings → Agent, distributor & Superagent logins**. For account security, invitations never email or embed a password; the user creates one through the link and then signs in with the emailed address and chosen password.

Use **Settings** in the dashboard sidebar to update the administrator name, sign-in email, or password. Profile changes are stored in MongoDB; the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` initialize the profile on its first successful sign-in. Confirm the current password for every profile update, and choose a new password of at least 12 characters. Saving changes signs out other active sessions.

## Mobile apps

The `mobile/` Expo project includes Commuter, Agent, and Distributor modes. On the same Wi-Fi, the app automatically uses the Expo development server's host address for its API connection. If using Expo Tunnel or a standalone build, set `EXPO_PUBLIC_API_URL` in `mobile/.env` to the computer's current LAN IP and port 3000 (never `localhost` on a physical phone). On Windows, find the IPv4 address with `Get-NetIPAddress -AddressFamily IPv4`; use the address for the Wi-Fi adapter, and make sure the phone is on the same network. From the phone's browser, open `http://<computer-LAN-IP>:3000/api/health`; a JSON response confirms the phone can reach the API. Restart Expo after changing `.env` so the URL is included in the app. The backend listens on all network interfaces; allow incoming Node.js traffic on port 3000 through Windows Firewall. Then run:

```sh
cd mobile
copy .env.example .env
npm install
npm start
```

The mobile app starts with commuter account creation or sign-in. After authentication, commuters can choose **Find active agents near me** and allow location access to search within 500 m. Results include agents with positive float whose location was updated within the last 15 minutes, and show each agent’s exact float amount. If no agents are returned, an agent nearby must sign in and share a fresh GPS location.

Agent and Distributor dashboards require an email and password. Administrators create and disable these linked accounts in **Settings → Agent, distributor & Superagent logins**; creation sends a one-time password setup link by email, and there is no mobile self-registration. Each account is linked to one existing Agent or Distributor profile, and mobile API access is limited to that linked record and (for distributors) their own assignments. Agent and Distributor profile forms do not ask for coordinates; location is recorded automatically when the user enables GPS sharing in the mobile app. Distributors start off duty; tapping **Go on duty & share GPS** gets and posts a fresh GPS fix before marking them available, records the shift start time, and immediately notifies the administrator dashboard. Background location updates continue while on duty, and **Refresh GPS now** can send a fresh fix manually. The distributor list shows when the current or most recent shift started. Until a recent GPS location is available, the profile cannot be selected for location-based dispatches.

Ticket sales are reported by distributors when completing an assigned replacement-float delivery, not entered by agents. The distributor records **sales collected** and **replacement float delivered** separately. The backend subtracts collected sales from the agent's existing POS float, then adds only the delivered replacement float; both amounts are recorded separately in the ledger and admin dispatch history. Collected sales cannot exceed the agent's available float. Low balances trigger an SOS alert. Agents can privately message operations from **Messages**; this conversation is separate from Superagent chat. Agents can also request float support with their current GPS location; the request appears in the admin inbox and dispatch board and is also delivered to the assigned Superagent's separate **Agent float support requests** panel. This float alert is not copied into or mixed with the private agent–Superagent chat. The agent cannot select or assign a distributor: an administrator reviews each request, selects an eligible nearby distributor, and sends the transfer task.

In MongoDB, the same salted password hash is stored in `mobile_accounts.passwordHash` and the linked `agents.passwordHash` or `distributors.passwordHash` field whenever an account is created or its password is set/reset. On backend startup, missing profile hashes are backfilled from valid linked mobile-account hashes. Hashes are excluded from normal profile queries and API responses; original passwords are not recoverable. If a linked login has no valid hash, reset its password in the admin dashboard. Mobile session tokens are kept in platform secure storage. The app opens on commuter account creation or sign-in; after authentication, commuters see the nearby-agent map and **Contact support** call button. Commuter searches require an active commuter account and are limited to 500 m; agent cards and map markers display exact float amounts without availability colors. Staff use a separate **Agent or Distributor sign in** path with administrator-provisioned access. Agent and Distributor dashboards separate **Home** and **Messages**, and their account header provides Settings and Sign out. Users can edit their own name, phone number, and area, and update their sign-in email or password in Settings. Credential changes require the current password, new passwords must be at least 12 characters, and other active sessions are revoked.

The mobile app offers English, Kinyarwanda, and French for Commuter, Agent, and Distributor screens; Kinyarwanda is the default and the selection is remembered. The language control appears on the default Commuter menu; tap it to choose a language, and the choice updates every mobile role screen. Return to Commuter to change languages. In Commuter mode, create an account or sign in first, then tap **Shaka abakozi bakora hafi yanjye** (or **Find active agents near me** in English) and allow location access to search within 500 m. The dashboard shows the total number found and exact RWF float amounts; if more than 100 match, it lists the 100 nearest and reports the full count. Results include agents whose location was updated in the last 15 minutes and who have float remaining; tap a result for map directions. The authenticated commuter map uses neutral markers rather than float availability colors. The separate admin web map continues to use availability colors and does not expose exact balances. The agent directory remains administrator-only and shows exact RWF balances. Its sort options include highest/lowest float and most recorded ticket-sale value over the past 30 days.

Background GPS requires an iOS/Android development or production build; Expo Go does not support background location. Configure `GOOGLE_MAPS_API_KEY` for Android release builds. Users must grant location permission. Mobile operating systems may pause or stop background updates when the user force-quits the app. The development config permits local HTTP API traffic; use HTTPS and disable cleartext traffic for production builds.

To start the mobile development server from the root, run `npm run dev:mobile` in a second terminal.

## Production-style web run

```sh
npm run build
npm start
```

Open `http://localhost:3000`. Express serves the compiled React app and API. MongoDB 2dsphere indexes are created for agents, distributors, and alerts on server startup. The API retries transient MongoDB connection failures with increasing delays and starts listening after the database is available. Configure `MONGODB_URI`, `SOS_THRESHOLD_RWF`, and `WEB_ORIGIN` in `server/.env`. `WEB_ORIGIN` is a comma-separated allowlist. Set `ROUTING_BASE_URL` to an OSRM-compatible routing service to attach road geometry and travel-time estimates to dispatches. Without it, dispatch matching still selects the closest available distributor by indexed geodesic distance and stores a straight-line route fallback.

## API overview

All locations use GeoJSON Point coordinates in `[longitude, latitude]` order.

If dispatch matching finds no eligible distributor because active profiles are off duty or their GPS is missing or stale, the admin assignment dialog can send them a persistent Distributor inbox message asking them to go on duty and refresh GPS. This is only a request; assignment still requires a fresh location within 500 m.

Commuters create an account in the mobile app and then see the live agent map centered on their current location, with active agents limited to 500 m and map marker colors indicating float availability. The map does not reveal exact agent float balances. Agent and Distributor accounts are not self-service: administrators provision their mobile login credentials and users can only sign in with those accounts. The Agent directory includes tracked shift hours; hours begin when an agent goes on duty and accumulate when they end the shift.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | API and database health |
| GET | `/api/auth/me` | Current signed-in administrator profile |
| PATCH | `/api/auth/profile` | Update administrator name, email, or password |
| POST | `/api/auth/mobile/login` | Sign in to an administrator-provisioned Agent, Distributor, or Superagent account |
| POST | `/api/auth/mobile/activate` | Set a password from a one-time staff invitation link |
| GET | `/api/auth/mobile/me` | Current mobile account and its linked profile (bearer token required) |
| POST | `/api/auth/commuter/register` | Create a commuter account with a name, email, and 12+ character password |
| POST | `/api/auth/commuter/login` | Sign in to a commuter account |
| GET, POST | `/api/admin/mobile-accounts` | List or provision mobile accounts, including Superagents (administrator session required) |
| POST | `/api/admin/mobile-accounts/:id/invitation` | Resend an unexpired or expired pending account invitation |
| PATCH | `/api/admin/mobile-accounts/:id` | Update Superagent details, credentials, agent assignments, or account status; revokes its sessions |
| DELETE | `/api/admin/mobile-accounts/:id` | Remove a Superagent account when it has no pending agent deletion requests |
| POST | `/api/admin/agents` | Create an agent profile and linked mobile login atomically; optional opening float is recorded in the ledger and an active Superagent can be assigned at creation |
| POST | `/api/admin/distributors` | Create a distributor profile and linked mobile login atomically |
| PATCH | `/api/admin/:role/:id` | Update an agent or distributor profile and login email; an optional new password revokes existing sessions |
| PATCH | `/api/admin/:role/:id/archive` | Archive or restore a profile (`archived: true/false`); archiving disables mobile login and retains financial history |
| GET, POST | `/api/agents` | List or register agents |
| PATCH | `/api/agents/:id/profile` | Update an agent's name, phone, or area |
| POST | `/api/agents/:id/telemetry` | Update agent GPS and check the stored float for a low-float SOS (mobile bearer token required); submitted balances are ignored |
| POST | `/api/agents/:id/ticket-sales` | Atomically record a commuter ticket sale and deduct agent float; at or below the higher of RWF 10,000, 10% of the current replenishment target, or the configured safe threshold, automatically mark the agent at risk and send an SOS float-transfer alert to admins (mobile bearer token required) |
| POST | `/api/agents/:id/support` | Send a location-tagged float-support request to admins and the agent's assigned active Superagent (mobile bearer token required); stored separately from agent–Superagent chat |
| GET | `/api/agents/:id/float-settlements` | Agent's recent settlement reports (agent token required) |
| POST | `/api/agents/:id/float-settlements` | Submit an end-of-day bank-slip report with a JPEG, PNG, or WebP proof image (maximum 2 MB; agent token required) |
| GET | `/api/float-settlements` | Admin settlement queue and history; approved credits appear in the completed top-ups table |
| GET | `/api/float-settlements/:id/bank-slip` | View bank-slip proof (administrator session required) |
| PATCH | `/api/float-settlements/:id` | Approve a verified deposit to credit float and record the resulting POS balance, or reject with a reason (administrator session required) |
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
| GET | `/api/admin/superagent-inbox` | Admin conversations with Superagents |
| POST | `/api/admin/superagent-inbox/:superagentId/messages` | Send a direct message to a Superagent |
| GET, POST | `/api/superagent/inbox` | Superagent's private admin chat; POST accepts a message of up to 500 characters |
| GET | `/api/admin/agent-inbox` | Admin conversations with active agents |
| POST | `/api/admin/agent-inbox/:agentId/messages` | Send a private direct message to an agent |
| GET, POST | `/api/agents/:id/admin-inbox` | Agent's private operations conversation (agent bearer token required) |
| GET, POST | `/api/agents/:id/superagent-inbox` | Agent's private conversation with the active Superagent assigned to that agent |
| GET | `/api/superagent/agent-inboxes` | List separate private conversations with the Superagent's assigned agents |
| GET | `/api/superagent/float-requests` | List float-support alerts from the Superagent's assigned agents, separate from direct chat |
| POST | `/api/superagent/agents/:agentId/inbox` | Reply in a private conversation with an assigned agent |
| POST | `/api/superagent/agents/:id/deletion-requests` | Ask an administrator to approve deletion of an assigned agent |
| DELETE | `/api/superagent/agents/:id` | Archive an assigned agent only after administrator approval; disables login and retains financial history |
| GET | `/api/dispatch-options?agentId=…` or `?alertId=…` | Find available distributors within 500 m, preferring the agent's zone and ranking by route ETA |
| POST | `/api/alerts/:id/dispatch` | Assign a selected or best-matched available distributor; optional `instructions` are sent with the task |
| POST | `/api/admin/agents/:id/dispatch` | Create or reuse an agent support alert and assign a selected or best-matched distributor |
| GET | `/api/dispatches` | Active assignments; `?status=completed` returns the 50 most recent completions with sales collected, replacement float delivered, and resulting POS balance |
| PATCH | `/api/dispatches/:id` | Assigned distributor updates task status or completes it with `salesCollected` and `amountAdded`; POS is reduced by sales collected and credited only with replacement float delivered |
| POST | `/api/dispatches/:id/messages` | Send a message in an active dispatch conversation (admin or assigned distributor) |
| GET | `/api/transactions?hours=24` | Recent ticket and float transactions |
| GET | `/api/liquidity/heatmap?hours=24` | Agent liquidity and activity points |
| GET | `/api/summary` | Network KPIs |
| GET | `/api/analytics?days=7` | Alert, dispatch, replenishment, and zone analytics |

Socket.IO broadcasts agent telemetry, SOS alerts, distributor positions, and dispatch events to administrators; each new dispatch is also sent privately to the assigned distributor's active mobile login. Distributor assignment is administrator-controlled: agent support and low-float alerts remain open until an admin selects a distributor. No background process automatically assigns queued alerts. The dispatch dialog fetches selectable nearby distributors for the chosen agent, using the agent's latest GPS position instead of a potentially stale SOS location. Matches must be on duty, have an active mobile login, and have GPS updated within 15 minutes; candidates are limited to 500 m, with same-zone matches prioritized and road-route travel time used when configured. If an on-duty distributor has stale GPS, the admin search requests a fresh location from the distributor app and retries matching for up to 10 seconds; the distributor can also use **Refresh GPS now**. If no match exists, the admin dialog reports counts for active logins, on-duty distributors, recent GPS updates, and candidates within range. The assignment rechecks availability, distance, and GPS freshness before committing, so an unavailable selection can be refreshed without creating a partial task. Administrators can edit the prefilled urgent float-transfer message (up to 500 characters); it is delivered immediately with the task and shown in the distributor's mobile app alongside directions and agent details. Admins and assigned distributors can reply in the dispatch conversation; messages are stored with the dispatch and delivered live to the other party. The separate **Distributor inbox** lets administrators and distributors message each other outside a dispatch; conversations are retained in MongoDB (latest 200 messages per distributor), delivered live, and limited to 500 characters per message. Agents and their assigned Superagent each have a separate private, live-updating inbox. MongoDB stores agents, alerts, distributors, commuter logs, operational events, dispatches, distributor inboxes, agent-Superagent inboxes, settlement reports, and transactions.

Administrators can manage agent and distributor profiles from their respective dashboard sections. When creating an agent, an active Superagent can be selected for immediate assignment; existing profiles can be assigned from **Settings → Agent, distributor & Superagent logins**. Agent zones can be selected from zones already in use or entered as a new zone in the profile form. Archiving is non-destructive: it hides the profile from normal lists, disables its linked mobile login, closes any queued agent SOS alerts, and retains historical records. Restoring a profile does not automatically re-enable its login. Creating or archiving a profile together with its linked records requires MongoDB transaction support.

For urgent float support, an administrator can open **Agent directory** and choose **Assign distributor** on the agent’s row, or choose **Choose & assign** from an open alert. The dialog lists eligible distributors near the agent; assignment remains administrator-controlled and requires the configured 500 m range, recent distributor GPS, an active login, and on-duty status. The distributor sees the task and transfer instructions in the mobile app. After delivering float, the distributor enters the amount actually handed over and taps **Complete top-up**; the backend atomically records that amount and the resulting POS float, credits the agent, and immediately updates the admin dashboard. Completed amounts and post-top-up POS balances remain visible under **Recent completed top-ups** on the Dispatch page.

Agent float is ledger-based: recorded ticket sales decrease it, and completing a distributor-assigned replenishment records a top-up and increases it. Agents can submit an end-of-day bank settlement with a bank reference and photo; reported float use is calculated from recorded ticket sales. Only an administrator can verify the slip and approve a credit, and that approval atomically records the float top-up and its audit event. The credit cannot exceed the stated bank deposit. A pending report blocks duplicate submissions, and a rejection requires a reason. Low-float ticket sales automatically raise an SOS; agents can also send operations a support message for urgent float or other problems. Agent GPS telemetry cannot change the balance. Agent telemetry/profile/status, distributor location/profile/status/tasks, and dispatch completion require a valid role-specific mobile bearer token and are restricted to the linked account. The agent/distributor directory endpoints remain administrator-only; public commuter discovery is separate. Socket.IO connections require an administrator cookie or mobile token; network-wide events are delivered only to administrators. Configure authentication, authorization, TLS, privacy retention, and trusted origins before exposing the API to agent devices or the public internet. Background location is subject to iOS and Android permission, battery, and process-lifecycle limits.
To create a Superagent account, sign in to the admin dashboard and open **Settings** in the sidebar. In **Agent, distributor & Superagent logins**, choose **Superagent** as the account type, enter the person's name, select the agents they should manage, and enter a sign-in email. Choose **Create Superagent account** to provision the account and email a one-time password setup link. Each agent can be assigned to only one active Superagent; you can change assignments later from **Manage assigned agents**. The account appears in the mobile account list, where an administrator can resend a pending invitation, edit its details or credentials, disable it, or remove it when it has no pending deletion requests. Agents, distributors, and Superagents cannot edit their own account details; administrators manage staff profiles and credentials from the dashboard. Commuters can edit their own profile and sign-in credentials from **Settings** in the mobile app. Staff can sign in through the mobile app's **Agent, Distributor or Superagent sign in** option after setting their password. Superagents can create and edit their assigned Agent profiles and view their POS float, but only an administrator can create each Agent's login/POS account or arrange float. Agents and their assigned Superagent can send messages in a private conversation for that agent; conversations are not shared with other assigned agents. Administrators can message Superagents separately from **Superagent chat**, and Superagents can reply from the **Admin chat** tab. Requesting agent deletion requires a reason and does not immediately remove the agent. The request appears in the admin's **Superagent deletion requests** queue; admin approval gives the requesting Superagent permission to archive the agent, but does not archive it immediately. The Superagent must then confirm deletion. Archiving disables the agent login and retains financial history. If the admin rejects the request, a rejection reason is required and is shown to the requesting Superagent. A distributor is not permanently attached to an agent: administrators assign a distributor to each replenishment dispatch, which requires the agent and distributor to share current GPS locations and the distributor to be on duty within 500 m. The mobile app opens on commuter account creation or sign-in; staff access remains a separate administrator-provisioned sign-in.

Staff invitation emails contain a 24-hour, one-time link to choose a password; they never contain a generated password. Resend a pending invite from the mobile account list in Settings. Existing Superagent accounts can be viewed in the account list, edited (including password reset), assigned agents managed, disabled or re-enabled, and deleted when there are no pending deletion requests. Only administrator-created, active Superagent accounts can use the mobile staff sign-in.

## Server structure

The backend lives in `server/` and is organized by responsibility:

- `server/index.js` loads configuration, creates Express and Socket.IO, installs shared authentication middleware, registers routes, and starts MongoDB and the HTTP server.
- `server/models/` defines MongoDB schemas and indexes by domain. Import the model collection from `server/models/index.js`.
- `server/controllers/` contains request handlers for authentication, administration, inboxes, network operations, dispatch, and analytics.
- `server/routes/` holds route-module entry points that forward to their matching controller modules.
- `server/utils/` contains shared authentication, validation, email, and other helper functions.
- `server/config/` contains server configuration.
- `server/routing.js` provides road-routing with a straight-line fallback.
- `server/seed.js` seeds local development data.

Controller modules export a registration function and receive shared models, middleware, services, and Express/Socket.IO instances from `server/index.js`. Keep route paths and middleware order stable when adding endpoints. Start the API from the repository root with `npm run dev:api` or `npm start`.
