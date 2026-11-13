require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const axios=require('axios')
const mongoose = require('mongoose');
const multer = require('multer');
const { Server } = require('socket.io');
const crypto = require('crypto');
const {getRoute}=require('./routing');
const { createServerConfig } = require('./config/serverConfig');
const { validPoint, mobileProfileUpdates, publicIdQuery } = require('./utils/validation');
const createAuthHelpers = require('./utils/auth');
const { Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold } = require('./models');
const { adminEmail, adminPassword, authSecret, allowedOrigins } = createServerConfig(process.env);

if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET)) {
  throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET before running in production.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
const sosThreshold = Number(process.env.SOS_THRESHOLD_GBP || 40);
const distributorLocationMaxAgeMs = 15 * 60 * 1000;
const dispatchSearchRadiusMeters = 500;
const bankSlipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Upload the bank slip as a JPEG, PNG, or WebP image.'));
    }
    callback(null, true);
  }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

const authHelpers = createAuthHelpers({ authSecret, adminEmail, adminPassword, AdminProfile, MobileAccount, CommuterAccount, Agent, Distributor, lowFloatThreshold });
const { issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = authHelpers;

function broadcast(event, data) { io.to('admin').emit(event, data); }
async function notifyAssignedDistributor(dispatch) {
  const distributorId = dispatch?.distributor?._id || dispatch?.distributor;
  if (!distributorId) return;
  const account = await MobileAccount.findOne({
    role: 'distributor', distributor: distributorId, active: true
  }).select('_id').lean();
  if (account) io.to(`mobile:${account._id}`).emit('dispatch:created', dispatch);
}

const routeDependencies = {
  app, io, mongoose, crypto, axios, getRoute,
  Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent,
  AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox,
  SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret,
  allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload,
  validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor,
  issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery,
  sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash,
  mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError
};
require('./routes/auth')(routeDependencies);
require('./routes/admin')(routeDependencies);
app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', now: new Date().toISOString() }));

// Device data is scoped to a matching mobile account; admin routes use the admin session.
app.use('/api', (req, res, next) => {
  const p = req.path;
  if (p === '/health' || p === '/auth/mobile/login') return next();
  if (p === '/commuter/nearby') {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    const session = match && verifySignedToken(match[1]);
    return session?.role === 'commuter'
      ? requireMobile('commuter')(req, res, next)
      : requireAdmin(req, res, next);
  }
  if (p === '/auth/mobile/me' || p === '/auth/mobile/logout') {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    const session = match && verifySignedToken(match[1]);
    if (!session || !['agent', 'distributor', 'superagent', 'commuter'].includes(session.role)) return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
    return requireMobile(session.role)(req, res, next);
  }
  if (p.startsWith('/auth/')) return next();
  if (req.method === 'GET' && /^\/distributors\/[^/]+\/tasks$/.test(p)) return requireMobile('distributor')(req, res, next);
  if ((req.method === 'GET' || req.method === 'POST') && p === '/distributor-inbox') return requireMobile('distributor')(req, res, next);
  if (p.startsWith('/superagent/')) return requireMobile('superagent')(req, res, next);
  if (req.method === 'GET' && p === '/agents') {
    const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    const session = match && verifySignedToken(match[1]);
    if (session?.role === 'superagent') return requireMobile('superagent')(req, res, next);
  }
  if (req.method === 'POST' && /^\/agents\/[^/]+\/(telemetry|support|ticket-sales|float-settlements)$/.test(p)) return requireMobile('agent')(req, res, next);
  if (req.method === 'GET' && /^\/agents\/[^/]+\/float-settlements$/.test(p)) return requireMobile('agent')(req, res, next);
  if (req.method === 'PATCH' && /^\/agents\/[^/]+\/(profile|status)$/.test(p)) return requireMobile('agent')(req, res, next);
  if (req.method === 'PATCH' && /^\/distributors\/[^/]+\/(location|profile|status)$/.test(p)) return requireMobile('distributor')(req, res, next);
  if ((req.method === 'PATCH' && /^\/dispatches\/[^/]+$/.test(p)) ||
      (req.method === 'POST' && /^\/dispatches\/[^/]+\/messages$/.test(p))) return requireMobile('distributor')(req, res, next);
  return requireAdmin(req, res, next);
});

require('./routes/inboxes')(routeDependencies);
Object.assign(routeDependencies, require('./routes/network')(routeDependencies));
Object.assign(routeDependencies, require('./routes/dispatch')(routeDependencies));
require('./routes/analytics')(routeDependencies);
app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));

// Client-side React routes fall back to the Vite production entry point.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'), error => { if (error) next(); });
});

io.use(async (socket, next) => {
  try {
    const adminSession = sessionFromToken(socket.handshake.auth?.token) || sessionFromRequest(socket.request);
    if (adminSession) {
      const profile = await AdminProfile.findOne({ key: 'primary' }).select('email sessionVersion');
      if (profile && profile.email === adminSession.sub && profile.sessionVersion === (adminSession.sessionVersion ?? 0)) {
        socket.data.admin = true;
        socket.data.expiresAt = adminSession.exp;
        return next();
      }
    }
    const session = verifySignedToken(socket.handshake.auth?.token);
    if (session && ['agent', 'distributor', 'superagent'].includes(session.role) && mongoose.isValidObjectId(session.sub)) {
      const account = await MobileAccount.findById(session.sub);
      if (account && account.active && account.role === session.role && account.sessionVersion === session.sessionVersion) {
        socket.data.mobile = account;
        socket.data.expiresAt = session.exp;
        return next();
      }
    }
    next(new Error('Authentication required.'));
  } catch (error) {
    next(error);
  }
});
io.on('connection', socket => {
  if (socket.data.admin) socket.join('admin');
  if (socket.data.mobile) socket.join(`mobile:${socket.data.mobile._id}`);
  const expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(0, socket.data.expiresAt - Date.now()));
  socket.on('disconnect', () => clearTimeout(expiryTimer));
  socket.emit('network:connected', { connectedAt: new Date().toISOString() });
  socket.on('agent:telemetry', async payload => {
    try {
      if (!payload?.agentId || !mongoose.isValidObjectId(payload.agentId) || !validPoint(payload.location)) return socket.emit('telemetry:error', { error: 'A valid agent ID and GeoJSON location are required.' });
      if (!socket.data.admin && (socket.data.mobile?.role !== 'agent' || String(socket.data.mobile.agent) !== String(payload.agentId))) {
        return socket.emit('telemetry:error', { error: 'This account cannot update that agent.' });
      }
      const agent = await Agent.findById(payload.agentId);
      if (!agent) return socket.emit('telemetry:error', { error: 'Agent not found.' });
      agent.location = payload.location;
      agent.lastSeenAt = new Date();
      agent.last_updated = agent.lastSeenAt;
      agent.status = agent.floatBalance <= lowFloatThreshold(agent) ? 'at_risk' : 'active';
      await agent.save();
      broadcast('agent:telemetry', agent);
      if (agent.floatBalance <= lowFloatThreshold(agent)) await routeDependencies.notifyLowFloat(agent);
      else await routeDependencies.resolveAgentAlerts(agent);
    } catch (error) { socket.emit('telemetry:error', { error: error.message }); }
  });
});

const port = Number(process.env.PORT || 3000);
async function connectToDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/tap_and_go';
  let retryDelay = 1000;
  while (mongoose.connection.readyState !== 1) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    } catch (error) {
      console.error(`MongoDB connection failed: ${error.message}. Retrying in ${retryDelay / 1000}s.`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
}

async function startServer() {
  await connectToDatabase();
  await Promise.all([Agent,Distributor,Alert,Dispatch,Transaction,FloatSettlement,CommuterLog,OperationalEvent,AdminProfile,MobileAccount,CommuterAccount,DistributorInbox,SuperagentDeletionRequest].map(model=>model.init()));
  const backfilled = await backfillProfilePasswordHashes();
  if (backfilled.agents || backfilled.distributors) {
    console.log(`Backfilled password hashes for ${backfilled.agents} agent and ${backfilled.distributors} distributor profiles.`);
  }
  server.listen(port, '0.0.0.0',()=>console.log(`Tap & Go operations server listening on port ${port} (all network interfaces)`));
}

startServer().catch(error => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
