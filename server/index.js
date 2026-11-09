require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const { Server } = require('socket.io');
const crypto = require('crypto');
const {getRoute}=require('./routing');
const { Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold } = require('./models');
const adminEmail = process.env.ADMIN_EMAIL || 'admin@tapandgo.local';
const adminPassword = process.env.ADMIN_PASSWORD || 'TapGoDev2026!';
const authSecret = process.env.AUTH_SECRET || 'local-development-secret-change-before-deploying';
if (process.env.NODE_ENV === 'production' && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.AUTH_SECRET)) {
  throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD, and AUTH_SECRET before running in production.');
}

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.WEB_ORIGIN || 'http://localhost:5173,http://localhost:3000').split(',').map(origin => origin.trim());
const io = new Server(server, { cors: { origin: allowedOrigins } });
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
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

function validPoint(location) {
  return location?.type === 'Point' && Array.isArray(location.coordinates) &&
    location.coordinates.length === 2 && location.coordinates.every(Number.isFinite) &&
    location.coordinates[0] >= -180 && location.coordinates[0] <= 180 &&
    location.coordinates[1] >= -90 && location.coordinates[1] <= 90;
}
function mobileProfileUpdates(body = {}) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
      const error = new Error('Name must be between 1 and 80 characters.');
      error.status = 400;
      throw error;
    }
    updates.name = body.name.trim();
  }
  for (const field of ['phone', 'place']) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const maximum = field === 'phone' ? 32 : 100;
    if (typeof body[field] !== 'string' || body[field].trim().length > maximum) {
      const error = new Error(`${field} must be no more than ${maximum} characters.`);
      error.status = 400;
      throw error;
    }
    updates[field] = body[field].trim();
  }
  if (!Object.keys(updates).length) {
    const error = new Error('Provide at least one profile field to update.');
    error.status = 400;
    throw error;
  }
  return updates;
}
function publicIdQuery(id,publicField){return mongoose.isValidObjectId(id)?{_id:id}:{[publicField]:id}}
function broadcast(event, data) { io.to('admin').emit(event, data); }
async function notifyAssignedDistributor(dispatch) {
  const distributorId = dispatch?.distributor?._id || dispatch?.distributor;
  if (!distributorId) return;
  const account = await MobileAccount.findOne({
    role: 'distributor', distributor: distributorId, active: true
  }).select('_id').lean();
  if (account) io.to(`mobile:${account._id}`).emit('dispatch:created', dispatch);
}
function issueAdminSession(email, sessionVersion = 0, expiresAt = Date.now() + 8 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ sub: email, sessionVersion, exp: expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function issueMobileSession(account, expiresAt = Date.now() + 8 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({
    sub: String(account._id), role: account.role, sessionVersion: account.sessionVersion, exp: expiresAt
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifySignedToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', authSecret).update(payload).digest();
  let provided;
  try { provided = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function requireMobile(role) {
  return async (req, res, next) => {
    try {
      const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
      const session = match && verifySignedToken(match[1]);
      if (!session || session.role !== role || !mongoose.isValidObjectId(session.sub)) {
        return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
      }
      const account = role === 'commuter'
        ? await CommuterAccount.findById(session.sub)
        : await MobileAccount.findById(session.sub);
      if (!account || !account.active || (role !== 'commuter' && account.role !== role) || account.sessionVersion !== session.sessionVersion) {
        return res.status(401).json({ error: 'Your mobile session expired. Please sign in again.' });
      }
      const profileExists = role === 'commuter' || role === 'superagent' || (role === 'agent'
        ? await Agent.exists({ _id: account.agent, archivedAt: null })
        : await Distributor.exists({ _id: account.distributor, archivedAt: null }));
      if (!profileExists) return res.status(401).json({ error: 'This profile is archived. Contact your administrator.' });
      req.mobile = { account, session };
      next();
    } catch (error) { apiError(res, error); }
  };
}
function mobileEntityQuery(req, id, publicField) {
  const reference = req.mobile.account.role === 'agent' ? req.mobile.account.agent : req.mobile.account.distributor;
  return { $and: [publicIdQuery(id, publicField), { _id: reference }] };
}
function sessionFromRequest(req) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)tapgo_admin_session=([^;]+)/);
  if (!match) return null;
  const [payload, signature] = decodeURIComponent(match[1]).split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', authSecret).update(payload).digest();
  let provided;
  try { provided = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() && typeof data.sub === 'string' ? data : null;
  } catch { return null; }
}
function requireAdmin(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Sign in to access network operations.' });
  AdminProfile.findOne({ key: 'primary' }).then(async profile => {
    const version = session.sessionVersion ?? 0;
    if (!profile) {
      if (session.sub !== adminEmail.toLowerCase() || version !== 0) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
      try {
        profile = await AdminProfile.create({ name: adminEmail.split('@')[0].replace(/[._-]+/g, ' '), email: adminEmail, passwordHash: hashPassword(adminPassword) });
      } catch (error) {
        if (error.code !== 11000) throw error;
        profile = await AdminProfile.findOne({ key: 'primary' });
      }
    }
    if (!profile || profile.email !== session.sub || profile.sessionVersion !== version) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    req.admin = { ...session, name: profile.name };
    next();
  }).catch(error => apiError(res, error));
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatchesHash(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
async function backfillProfilePasswordHashes() {
  const accounts = await MobileAccount.find({ passwordHash: { $exists: true } })
    .select('role agent distributor +passwordHash')
    .lean();
  const agentUpdates = [];
  const distributorUpdates = [];
  for (const account of accounts) {
    if (!/^[a-f\d]{32}:[a-f\d]{128}$/i.test(account.passwordHash || '')) continue;
    if (account.role === 'agent' && account.agent) {
      agentUpdates.push({
        updateOne: {
          filter: { _id: account.agent, passwordHash: { $in: [null, ''] } },
          update: { $set: { passwordHash: account.passwordHash } }
        }
      });
    } else if (account.role === 'distributor' && account.distributor) {
      distributorUpdates.push({
        updateOne: {
          filter: { _id: account.distributor, passwordHash: { $in: [null, ''] } },
          update: { $set: { passwordHash: account.passwordHash } }
        }
      });
    }
  }
  const [agents, distributors] = await Promise.all([
    agentUpdates.length ? Agent.bulkWrite(agentUpdates, { ordered: false }) : null,
    distributorUpdates.length ? Distributor.bulkWrite(distributorUpdates, { ordered: false }) : null
  ]);
  return {
    agents: agents?.modifiedCount || 0,
    distributors: distributors?.modifiedCount || 0
  };
}
function passwordMatchesConfig(password) {
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(password).digest(),
    crypto.createHash('sha256').update(adminPassword).digest()
  );
}
function setAdminCookie(res, profile) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
  res.setHeader('Set-Cookie', `tapgo_admin_session=${encodeURIComponent(issueAdminSession(profile.email, profile.sessionVersion, expiresAt))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
  return expiresAt;
}
function apiError(res, error) {
  console.error(error);
  const status=error.status||((error.name==='CastError'||error.name==='ValidationError')?400:(error.code===11000?409:500));
  res.status(status).json({ error: status<500?error.message:'Internal server error' });
}

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  try {
    if (!email || password.length > 1024) return res.status(401).json({ error: 'Email or password is incorrect.' });
    let profile = await AdminProfile.findOne({ key: 'primary' }).select('+passwordHash');
    if (!profile) {
      const emailMatches = crypto.timingSafeEqual(crypto.createHash('sha256').update(email).digest(), crypto.createHash('sha256').update(adminEmail.toLowerCase()).digest());
      if (!emailMatches || !passwordMatchesConfig(password)) return res.status(401).json({ error: 'Email or password is incorrect.' });
      try {
        profile = await AdminProfile.create({ name: adminEmail.split('@')[0].replace(/[._-]+/g, ' '), email: adminEmail, passwordHash: hashPassword(password) });
      } catch (error) {
        if (error.code !== 11000) throw error;
        profile = await AdminProfile.findOne({ key: 'primary' }).select('+passwordHash');
      }
    }
    if (!profile || profile.email !== email || !passwordMatchesHash(password, profile.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const expiresAt = setAdminCookie(res, profile);
    res.json({ email: profile.email, name: profile.name, expiresAt, expiresIn: 28800 });
  } catch (error) { apiError(res, error); }
});
app.post('/api/auth/mobile/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || password.length > 1024) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const account = await MobileAccount.findOne({ email }).select('+passwordHash');
    if (!account || !account.active || !passwordMatchesHash(password, account.passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }
    const profileExists = account.role === 'superagent' || (account.role === 'agent'
      ? await Agent.exists({ _id: account.agent, archivedAt: null })
      : await Distributor.exists({ _id: account.distributor, archivedAt: null }));
    if (!profileExists) return res.status(401).json({ error: 'This profile is archived. Contact your administrator.' });
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    res.json({
      token: issueMobileSession(account, expiresAt),
      expiresAt,
      account: { id: String(account._id), email: account.email, role: account.role }
    });
  } catch (error) { apiError(res, error); }
});
app.post('/api/auth/commuter/register', async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name || name.length > 80) return res.status(400).json({ error: 'Name must be between 1 and 80 characters.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 12 || password.length > 1024) return res.status(400).json({ error: 'Password must be at least 12 characters.' });
    if (email === adminEmail.toLowerCase() || await AdminProfile.exists({ email })) return res.status(409).json({ error: 'This email is already used by an administrator account.' });
    if (await MobileAccount.exists({ email })) return res.status(409).json({ error: 'This email is already used by an administrator-created Agent or Distributor account.' });
    const commuter = await CommuterAccount.create({ name, email, passwordHash: hashPassword(password) });
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    res.status(201).json({
      token: issueMobileSession({ _id: commuter._id, role: 'commuter', sessionVersion: commuter.sessionVersion }, expiresAt),
      expiresAt,
      account: { id: String(commuter._id), email: commuter.email, role: 'commuter' }
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' });
    apiError(res, error);
  }
});
app.post('/api/auth/commuter/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const commuter = await CommuterAccount.findOne({ email, active: true }).select('+passwordHash');
    if (!commuter || !passwordMatchesHash(password, commuter.passwordHash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    res.json({
      token: issueMobileSession({ _id: commuter._id, role: 'commuter', sessionVersion: commuter.sessionVersion }, expiresAt),
      expiresAt,
      account: { id: String(commuter._id), email: commuter.email, role: 'commuter' }
    });
  } catch (error) { apiError(res, error); }
});
app.get('/api/auth/mobile/me', async (req, res, next) => {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
  const session = match && verifySignedToken(match[1]);
  if (!session || !['agent', 'distributor', 'superagent', 'commuter'].includes(session.role)) return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
  return requireMobile(session.role)(req, res, async () => {
    try {
      const account = req.mobile.account;
      const entity = session.role === 'commuter'
        ? { name: account.name }
        : session.role === 'agent'
          ? await Agent.findById(account.agent).select('name phone place zone location floatBalance floatReference safeThreshold liquidityStatus status agent_id shiftStartedAt shiftSeconds').lean()
          : session.role === 'distributor'
            ? await Distributor.findById(account.distributor).select('name phone place location status distributor_id').lean()
            : { name: account.name };
      if (!entity) return res.status(401).json({ error: 'The mobile account is no longer linked to a profile.' });
      res.json({
        id: String(account._id), email: account.email, role: session.role,
        entity: account.role === 'agent' ? { ...entity, lowFloatThreshold: lowFloatThreshold(entity) } : entity
      });
    } catch (error) { apiError(res, error); }
  });
});
app.post('/api/auth/mobile/logout', async (req, res) => {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
  const session = match && verifySignedToken(match[1]);
  if (!session || !['agent', 'distributor', 'superagent', 'commuter'].includes(session.role)) return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
  return requireMobile(session.role)(req, res, async () => {
    try {
      const Account = session.role === 'commuter' ? CommuterAccount : MobileAccount;
      await Account.updateOne({ _id: req.mobile.account._id }, { $inc: { sessionVersion: 1 } });
      if (session.role !== 'commuter') io.in(`mobile:${req.mobile.account._id}`).disconnectSockets(true);
      res.json({ success: true });
    } catch (error) { apiError(res, error); }
  });
});
app.patch('/api/auth/mobile/profile', async (req, res, next) => {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
  const mobileSession = match && verifySignedToken(match[1]);
  if (!mobileSession || !['agent', 'distributor', 'superagent', 'commuter'].includes(mobileSession.role)) {
    return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
  }
  return requireMobile(mobileSession.role)(req, res, next);
}, async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const role = req.mobile.session.role;
    const accountId = req.mobile.account._id;
    const emailProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'email');
    const passwordProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'newPassword');
    const credentialChange = emailProvided || passwordProvided;
    const email = emailProvided ? String(req.body.email || '').trim().toLowerCase() : undefined;
    const newPassword = passwordProvided ? req.body.newPassword : undefined;
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const updates = {};
    for (const field of ['name', 'phone', 'place']) {
      if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) continue;
      if (field === 'name' && (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80)) {
        return res.status(400).json({ error: 'Name must be between 1 and 80 characters.' });
      }
      if (field === 'phone' && (typeof req.body.phone !== 'string' || req.body.phone.trim().length > 32)) {
        return res.status(400).json({ error: 'Phone number must be no more than 32 characters.' });
      }
      if (field === 'place' && (typeof req.body.place !== 'string' || req.body.place.trim().length > 100)) {
        return res.status(400).json({ error: 'Location must be no more than 100 characters.' });
      }
      updates[field] = req.body[field].trim();
    }
    if (['commuter', 'superagent'].includes(role) && (updates.phone !== undefined || updates.place !== undefined)) {
      return res.status(400).json({ error: 'Commuter profiles only support name and account credential updates.' });
    }
    if (emailProvided && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (passwordProvided && (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 1024)) {
      return res.status(400).json({ error: 'New password must be at least 12 characters.' });
    }
    if (credentialChange && (!currentPassword || currentPassword.length > 1024)) {
      return res.status(400).json({ error: 'Enter your current password to change account credentials.' });
    }
    if (!credentialChange && !Object.keys(updates).length) {
      return res.status(400).json({ error: 'Provide at least one profile or credential field to update.' });
    }
    const Commuter = role === 'commuter';
    const Account = Commuter ? CommuterAccount : MobileAccount;
    let updatedProfile;
    let rotatedToken;
    let expiresAt;
    await session.withTransaction(async () => {
      const account = await Account.findById(accountId).select('+passwordHash').session(session);
      if (!account || !account.active) {
        const error = new Error('Your account is no longer active.');
        error.status = 401;
        throw error;
      }
      if (credentialChange && !passwordMatchesHash(currentPassword, account.passwordHash)) {
        const error = new Error('Current password is incorrect.');
        error.status = 401;
        throw error;
      }
      if (emailProvided && email !== account.email) {
        const [adminExists, mobileExists, commuterExists] = await Promise.all([
          AdminProfile.exists({ email }),
          MobileAccount.exists({ email, _id: { $ne: Commuter ? null : account._id } }),
          CommuterAccount.exists({ email, _id: { $ne: Commuter ? account._id : null } })
        ]);
        if (adminExists || mobileExists || commuterExists) {
          const error = new Error('This email address is already in use.');
          error.status = 409;
          throw error;
        }
        account.email = email;
      }
      if (passwordProvided) account.passwordHash = hashPassword(newPassword);
      if (credentialChange) account.sessionVersion += 1;
      if (Commuter) {
        if (updates.name !== undefined) account.name = updates.name;
        await account.save({ session });
        updatedProfile = { name: account.name };
      } else if (role === 'superagent') {
        if (updates.name !== undefined) account.name = updates.name;
        await account.save({ session });
        updatedProfile = { name: account.name };
      } else {
        const Profile = role === 'agent' ? Agent : Distributor;
        const profileId = role === 'agent' ? account.agent : account.distributor;
        const profile = await Profile.findOne({ _id: profileId, archivedAt: null }).session(session);
        if (!profile) {
          const error = new Error('Your profile is no longer available.');
          error.status = 404;
          throw error;
        }
        for (const [field, value] of Object.entries(updates)) profile[field] = value;
        if (role === 'distributor' && updates.name) profile.full_name = updates.name;
        await profile.save({ session });
        if (passwordProvided) {
          await Profile.updateOne({ _id: profile._id }, { $set: { passwordHash: account.passwordHash } }, { session });
        }
        await account.save({ session });
        updatedProfile = profile.toObject();
      }
      if (credentialChange) {
        expiresAt = Date.now() + 8 * 60 * 60 * 1000;
        rotatedToken = issueMobileSession({
          _id: account._id, role, sessionVersion: account.sessionVersion
        }, expiresAt);
      }
    });
    if (credentialChange && role !== 'commuter') io.in(`mobile:${accountId}`).disconnectSockets(true);
    if (role === 'agent') broadcast('agent:telemetry', updatedProfile);
    if (role === 'distributor') broadcast('distributor:location', updatedProfile);
    res.json({
      account: { id: String(accountId), email: emailProvided ? email : req.mobile.account.email, role },
      entity: updatedProfile,
      ...(rotatedToken ? { token: rotatedToken, expiresAt } : {})
    });
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
});
app.post('/api/auth/logout', (_req, res) => {
  io.in('admin').disconnectSockets(true);
  res.setHeader('Set-Cookie', 'tapgo_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.get('/api/auth/me', requireAdmin, (req, res) => res.json({ email: req.admin.sub, name: req.admin.name || '', expiresAt: req.admin.exp }));
app.patch('/api/auth/profile', requireAdmin, async (req, res) => {
  try {
    const { name, email, currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024) return res.status(400).json({ error: 'Enter your current password to save profile changes.' });
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 80)) return res.status(400).json({ error: 'Name must be between 1 and 80 characters.' });
    const normalizedEmail = email === undefined ? undefined : String(email).trim().toLowerCase();
    if (normalizedEmail !== undefined && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 1024)) return res.status(400).json({ error: 'New password must be at least 12 characters.' });
    const profile = await AdminProfile.findOne({ key: 'primary' }).select('+passwordHash');
    if (!profile || !passwordMatchesHash(currentPassword, profile.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    if (name !== undefined) profile.name = name.trim();
    if (normalizedEmail !== undefined) profile.email = normalizedEmail;
    if (newPassword) profile.passwordHash = hashPassword(newPassword);
    profile.sessionVersion += 1;
    await profile.save();
    io.in('admin').disconnectSockets(true);
    const expiresAt = setAdminCookie(res, profile);
    res.json({ email: profile.email, name: profile.name, expiresAt });
  } catch (error) { apiError(res, error); }
});
app.get('/api/admin/mobile-accounts', requireAdmin, async (_req, res) => {
  try {
    const [accounts, agents, distributors] = await Promise.all([
      MobileAccount.find().populate('agent', 'name agent_id').populate('distributor', 'name distributor_id')
        .populate('managedAgents', 'name agent_id').sort({ createdAt: -1 }).lean(),
      Agent.find({ archivedAt: null }).select('name agent_id').sort({ name: 1 }).limit(1000).lean(),
      Distributor.find({ archivedAt: null }).select('name distributor_id').sort({ name: 1 }).limit(1000).lean()
    ]);
    res.json({
      accounts: accounts.map(account => ({
        id: String(account._id), role: account.role, email: account.email, active: account.active,
        profile: account.agent || account.distributor || (account.role === 'superagent'
          ? { name: account.name, _id: account._id } : null),
        managedAgents: account.managedAgents || []
      })),
      agents,
      distributors
    });
  } catch (error) { apiError(res, error); }
});
app.post('/api/admin/mobile-accounts', requireAdmin, async (req, res) => {
  let session;
  try {
    const role = req.body?.role;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const recordId = String(req.body?.recordId || '');
    if (!['agent', 'distributor', 'superagent'].includes(role)) return res.status(400).json({ error: 'Choose an agent, distributor, or Superagent role.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 12 || password.length > 1024) return res.status(400).json({ error: 'Set an initial password of at least 12 characters.' });
    const [adminExists, commuterExists] = await Promise.all([
      AdminProfile.exists({ email }),
      CommuterAccount.exists({ email })
    ]);
    if (adminExists || commuterExists) return res.status(409).json({ error: 'This email address is already in use.' });
    if (role === 'superagent') {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const managedAgentIds = Array.isArray(req.body?.managedAgentIds) ? [...new Set(req.body.managedAgentIds.map(String))] : [];
      if (!name || name.length > 80) return res.status(400).json({ error: 'Superagent name must be between 1 and 80 characters.' });
      if (managedAgentIds.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'Choose valid agent profiles.' });
      const [assigned, agents] = await Promise.all([
        MobileAccount.findOne({ role: 'superagent', active: true, managedAgents: { $in: managedAgentIds } }).select('_id').lean(),
        Agent.find({ _id: { $in: managedAgentIds }, archivedAt: null }).select('_id').lean()
      ]);
      if (assigned) return res.status(409).json({ error: 'One or more agents are already assigned to another active Superagent.' });
      if (agents.length !== managedAgentIds.length) return res.status(400).json({ error: 'Every assigned agent must be active.' });
      const [superagent] = await MobileAccount.create([{
        role, name, managedAgents: managedAgentIds, email, passwordHash: hashPassword(password)
      }]);
      return res.status(201).json({ id: String(superagent._id), role, name, email, active: superagent.active });
    }
    if (!mongoose.isValidObjectId(recordId)) return res.status(400).json({ error: 'Choose an existing profile.' });
    const Model = role === 'agent' ? Agent : Distributor;
    const passwordHash = hashPassword(password);
    session = await mongoose.startSession();
    let account;
    await session.withTransaction(async () => {
      const record = await Model.findById(recordId).select('_id').session(session);
      if (!record) {
        const error = new Error('The selected profile was not found.');
        error.status = 404;
        throw error;
      }
      [account] = await MobileAccount.create([{
        role,
        [role]: record._id,
        email,
        passwordHash
      }], { session });
      await Model.updateOne({ _id: record._id }, { $set: { passwordHash } }, { session });
    });
    res.status(201).json({ id: String(account._id), role: account.role, email: account.email, active: account.active });
  } catch (error) { apiError(res, error); }
  finally { if (session) await session.endSession(); }
});
app.patch('/api/admin/mobile-accounts/:id', requireAdmin, async (req, res) => {
  try {
    const account = await MobileAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Mobile account not found.' });
    const updates = {};
    if (account.role === 'superagent') {
      if (req.body?.name !== undefined) {
        if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.trim().length > 80) {
          return res.status(400).json({ error: 'Superagent name must be between 1 and 80 characters.' });
        }
        updates.name = req.body.name.trim();
      }
      if (req.body?.email !== undefined) {
        const email = String(req.body.email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          return res.status(400).json({ error: 'Enter a valid sign-in email address.' });
        }
        if (email !== account.email) {
          const [adminExists, mobileExists, commuterExists] = await Promise.all([
            AdminProfile.exists({ email }),
            MobileAccount.exists({ email, _id: { $ne: account._id } }),
            CommuterAccount.exists({ email })
          ]);
          if (adminExists || mobileExists || commuterExists) {
            return res.status(409).json({ error: 'This email address is already in use.' });
          }
        }
        updates.email = email;
      }
      if (req.body?.password !== undefined) {
        if (typeof req.body.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 1024) {
          return res.status(400).json({ error: 'Password must be at least 12 characters.' });
        }
        updates.passwordHash = hashPassword(req.body.password);
      }
    } else if (req.body?.name !== undefined || req.body?.email !== undefined || req.body?.password !== undefined) {
      return res.status(400).json({ error: 'Only Superagent account details can be edited here.' });
    }
    if (req.body?.active !== undefined) {
      if (typeof req.body.active !== 'boolean') return res.status(400).json({ error: 'Set active to true or false.' });
      if (req.body.active && account.role === 'superagent') {
        const conflictingAccount = await MobileAccount.findOne({
          _id: { $ne: account._id }, role: 'superagent', active: true,
          managedAgents: { $in: account.managedAgents }
        }).select('_id').lean();
        if (conflictingAccount) return res.status(409).json({ error: 'Some assigned agents are now managed by another active Superagent. Update the assignments first.' });
      }
      updates.active = req.body.active;
    }
    if (req.body?.managedAgentIds !== undefined) {
      if (account.role !== 'superagent' || !Array.isArray(req.body.managedAgentIds)) return res.status(400).json({ error: 'Only Superagent accounts can update their assigned agents.' });
      const managedAgentIds = [...new Set(req.body.managedAgentIds.map(String))];
      if (managedAgentIds.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ error: 'Choose valid agent profiles.' });
      const [assigned, agents] = await Promise.all([
        MobileAccount.findOne({ _id: { $ne: account._id }, role: 'superagent', active: true, managedAgents: { $in: managedAgentIds } }).select('_id').lean(),
        Agent.find({ _id: { $in: managedAgentIds }, archivedAt: null }).select('_id').lean()
      ]);
      if (assigned) return res.status(409).json({ error: 'One or more agents are already assigned to another active Superagent.' });
      if (agents.length !== managedAgentIds.length) return res.status(400).json({ error: 'Every assigned agent must be active.' });
      updates.managedAgents = managedAgentIds;
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Provide an account status or agent assignment update.' });
    Object.assign(account, updates);
    account.sessionVersion += 1;
    await account.save();
    io.in(`mobile:${account._id}`).disconnectSockets(true);
    res.json({ id: String(account._id), role: account.role, email: account.email, name: account.name, active: account.active });
  } catch (error) { apiError(res, error); }
});
app.delete('/api/admin/mobile-accounts/:id', requireAdmin, async (req, res) => {
  try {
    const account = await MobileAccount.findOne({ _id: req.params.id, role: 'superagent' });
    if (!account) return res.status(404).json({ error: 'Superagent account not found.' });
    if (await SuperagentDeletionRequest.exists({ superagent: account._id, status: 'pending' })) {
      return res.status(409).json({ error: 'Review pending agent deletion requests before removing this Superagent.' });
    }
    await SuperagentInbox.deleteOne({ superagent: account._id });
    await account.deleteOne();
    io.in(`mobile:${account._id}`).disconnectSockets(true);
    res.json({ id: String(account._id), deleted: true });
  } catch (error) { apiError(res, error); }
});

function adminProfileInput(body = {}, role) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const place = typeof body.place === 'string' ? body.place.trim() : '';
  const zone = typeof body.zone === 'string' ? body.zone.trim() : '';
  if (!name || name.length > 80) throw Object.assign(new Error('Name must be between 1 and 80 characters.'), { status: 400 });
  if (phone.length > 32) throw Object.assign(new Error('Phone number must be no more than 32 characters.'), { status: 400 });
  if (place.length > 100 || zone.length > 80) throw Object.assign(new Error('Area must be no more than 100 characters and zone no more than 80.'), { status: 400 });
  const updates = { name, phone, place };
  if (body.longitude !== undefined || body.latitude !== undefined) {
    const location = {
      type: 'Point',
      coordinates: [Number(body.longitude), Number(body.latitude)]
    };
    if (body.longitude === undefined || body.latitude === undefined || !validPoint(location)) {
      throw Object.assign(new Error('Provide valid longitude and latitude together.'), { status: 400 });
    }
    updates.location = location;
  }
  if (role === 'agent') updates.zone = zone;
  else updates.full_name = name;
  return updates;
}

function mobileCredentialsInput(body = {}, requirePassword) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error('Enter a valid sign-in email address.'), { status: 400 });
  }
  if ((requirePassword || password) && (password.length < 12 || password.length > 1024)) {
    throw Object.assign(new Error('Password must be at least 12 characters.'), { status: 400 });
  }
  return { email, password };
}

app.post('/api/admin/agents', requireAdmin, async (req, res) => {
  let session;
  try {
    const { email, password } = mobileCredentialsInput(req.body, true);
    const updates = adminProfileInput(req.body, 'agent');
    const passwordHash = hashPassword(password);
    const openingFloat = Number(req.body?.openingFloat ?? 0);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) return res.status(400).json({ error: 'Opening float must be a non-negative amount.' });
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const now = new Date();
      const [agent] = await Agent.create([{
        ...updates,
        agent_id: crypto.randomUUID(),
        agentType: 'mobile',
        agent_type: 'mobile',
        floatBalance: openingFloat,
        current_float: openingFloat,
        floatReference: openingFloat,
        safeThreshold: sosThreshold,
        status: openingFloat <= Math.max(sosThreshold, 10000, openingFloat * 0.1) ? 'at_risk' : 'active',
        lastSeenAt: now,
        last_updated: now
      }], { session });
      const [account] = await MobileAccount.create([{
        role: 'agent', agent: agent._id, email, passwordHash
      }], { session });
      await Agent.updateOne({ _id: agent._id }, { $set: { passwordHash } }, { session });
      if (openingFloat > 0) {
        await Transaction.create([{
          agent: agent._id, amount: openingFloat, kind: 'float_top_up',
          ...(agent.location ? { location: agent.location } : {})
        }], { session });
      }
      result = { agent, account };
    });
    broadcast('agent:telemetry', result.agent);
    if (result.agent.floatBalance <= lowFloatThreshold(result.agent)) await notifyLowFloat(result.agent);
    res.status(201).json({
      profile: result.agent,
      account: { id: String(result.account._id), role: result.account.role, email: result.account.email, active: result.account.active }
    });
  } catch (error) { apiError(res, error); }
  finally { if (session) await session.endSession(); }
});

app.post('/api/admin/distributors', requireAdmin, async (req, res) => {
  let session;
  try {
    const { email, password } = mobileCredentialsInput(req.body, true);
    const updates = adminProfileInput(req.body, 'distributor');
    const passwordHash = hashPassword(password);
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const [distributor] = await Distributor.create([{
        ...updates,
        distributor_id: crypto.randomUUID(),
        ...(updates.location ? { live_location: updates.location } : {}),
        status: 'offline',
        duty_state: 'inactive',
        lastSeenAt: new Date()
      }], { session });
      const [account] = await MobileAccount.create([{
        role: 'distributor', distributor: distributor._id, email, passwordHash
      }], { session });
      await Distributor.updateOne({ _id: distributor._id }, { $set: { passwordHash } }, { session });
      result = { distributor, account };
    });
    broadcast('distributor:location', result.distributor);
    res.status(201).json({
      profile: result.distributor,
      account: { id: String(result.account._id), role: result.account.role, email: result.account.email, active: result.account.active }
    });
  } catch (error) { apiError(res, error); }
  finally { if (session) await session.endSession(); }
});

app.patch('/api/admin/:role(agents|distributors)/:id', requireAdmin, async (req, res) => {
  const role = req.params.role === 'agents' ? 'agent' : 'distributor';
  try {
    const updates = adminProfileInput(req.body, role);
    const { email, password } = mobileCredentialsInput(req.body, false);
    const Model = role === 'agent' ? Agent : Distributor;
    const passwordHash = password ? hashPassword(password) : null;
    const session = await mongoose.startSession();
    let profile;
    let account;
    try {
      await session.withTransaction(async () => {
        profile = await Model.findOneAndUpdate(
          { ...publicIdQuery(req.params.id, role === 'agent' ? 'agent_id' : 'distributor_id'), archivedAt: null },
          { $set: { ...updates, ...(role === 'distributor' && updates.location ? { live_location: updates.location } : {}) } },
          { new: true, runValidators: true, session }
        );
        if (!profile) {
          const error = new Error(`${role === 'agent' ? 'Agent' : 'Distributor'} not found.`);
          error.status = 404;
          throw error;
        }
        account = await MobileAccount.findOne({ [role]: profile._id }).session(session);
        if (account) {
          account.email = email;
          if (passwordHash) account.passwordHash = passwordHash;
          account.sessionVersion += 1;
          await account.save({ session });
        } else {
          if (!password) {
            const error = new Error('Provide an initial password to create this profile’s mobile login.');
            error.status = 400;
            throw error;
          }
          [account] = await MobileAccount.create([{
            role, [role]: profile._id, email, passwordHash
          }], { session });
        }
        if (passwordHash) await Model.updateOne({ _id: profile._id }, { $set: { passwordHash } }, { session });
      });
    } finally { await session.endSession(); }
    if (account) io.in(`mobile:${account._id}`).disconnectSockets(true);
    if (role === 'agent') broadcast('agent:telemetry', profile);
    else broadcast('distributor:location', profile);
    res.json({ profile, account: account ? { id: String(account._id), role: account.role, email: account.email, active: account.active } : null });
  } catch (error) { apiError(res, error); }
});

app.delete('/api/admin/:role(agents|distributors)/:id', requireAdmin, async (req, res) => {
  const role = req.params.role === 'agents' ? 'agent' : 'distributor';
  try {
    const Model = role === 'agent' ? Agent : Distributor;
    const profile = await Model.findOne({ ...publicIdQuery(req.params.id, role === 'agent' ? 'agent_id' : 'distributor_id'), archivedAt: null });
    if (!profile) return res.status(404).json({ error: `${role === 'agent' ? 'Agent' : 'Distributor'} not found.` });
    const activeDispatch = await Dispatch.exists({
      [role]: profile._id,
      status: { $in: ['assigned', 'en_route'] }
    });
    if (activeDispatch) return res.status(409).json({ error: 'Complete or cancel active dispatches before archiving this profile.' });
    profile.archivedAt = new Date();
    if (role === 'agent') profile.status = 'offline';
    else profile.status = 'offline';
    await profile.save();
    const account = await MobileAccount.findOneAndUpdate(
      { [role]: profile._id },
      { $set: { active: false }, $inc: { sessionVersion: 1 } },
      { new: true }
    ).select('_id');
    if (account) io.in(`mobile:${account._id}`).disconnectSockets(true);
    if (role === 'agent') broadcast('agent:telemetry', profile);
    else broadcast('distributor:location', profile);
    res.json({ id: String(profile._id), archived: true, loginDisabled: Boolean(account) });
  } catch (error) { apiError(res, error); }
});

app.patch('/api/admin/:role(agents|distributors)/:id/archive', requireAdmin, async (req, res) => {
  const role = req.params.role === 'agents' ? 'agent' : 'distributor';
  const session = await mongoose.startSession();
  try {
    if (typeof req.body?.archived !== 'boolean') return res.status(400).json({ error: 'Set archived to true or false.' });
    const Model = role === 'agent' ? Agent : Distributor;
    let profile;
    let account;
    await session.withTransaction(async () => {
      profile = await Model.findOne({
        ...publicIdQuery(req.params.id, role === 'agent' ? 'agent_id' : 'distributor_id'),
        ...(req.body.archived ? { archivedAt: null } : { archivedAt: { $ne: null } })
      }).session(session);
      if (!profile) {
        const error = new Error('Profile not found.');
        error.status = 404;
        throw error;
      }
      if (!req.body.archived && await Dispatch.exists({ [role]: profile._id, status: { $in: ['assigned', 'en_route'] } }).session(session)) {
        const error = new Error('Cancel or complete active dispatches before restoring this profile.');
        error.status = 409;
        throw error;
      }
      profile.archivedAt = req.body.archived ? new Date() : null;
      profile.status = role === 'agent'
        ? (req.body.archived ? 'offline' : profile.floatBalance <= lowFloatThreshold(profile) ? 'at_risk' : 'active')
        : 'offline';
      await profile.save({ session });
      if (role === 'agent' && req.body.archived) {
        await Alert.updateMany(
          { agent: profile._id, state: { $in: ['open', 'dispatched'] } },
          { $set: { state: 'resolved', resolved_status: true, resolvedAt: new Date() } },
          { session }
        );
      }
      account = await MobileAccount.findOne({ [role]: profile._id }).session(session);
      if (account) {
        if (req.body.archived) account.active = false;
        account.sessionVersion += 1;
        await account.save({ session });
      }
    });
    if (account) io.in(`mobile:${account._id}`).disconnectSockets(true);
    if (role === 'agent') broadcast('agent:telemetry', profile);
    else broadcast('distributor:location', profile);
    res.json({ id: String(profile._id), archived: req.body.archived, loginEnabled: Boolean(account?.active) });
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', now: new Date().toISOString() }));

// Only commuter discovery is public; device data is scoped to an authenticated mobile account.
app.use('/api', (req, res, next) => {
  const p = req.path;
  if (p === '/health' || p === '/commuter/nearby' || p === '/auth/mobile/login') return next();
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

app.get('/api/distributor-inbox', async (req, res) => {
  try {
    const inbox = await DistributorInbox.findOne({ distributor: req.mobile.account.distributor })
      .select('messages updatedAt').lean();
    res.json(inbox || { messages: [], updatedAt: null });
  } catch (error) { apiError(res, error); }
});

app.post('/api/distributor-inbox', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    const account = req.mobile.account;
    const distributor = await Distributor.findOne({ _id: account.distributor, archivedAt: null }).select('name').lean();
    if (!distributor) return res.status(404).json({ error: 'Distributor profile not found.' });
    const message = { sender: 'distributor', senderName: distributor.name, text, sentAt: new Date() };
    const inbox = await DistributorInbox.findOneAndUpdate(
      { distributor: account.distributor },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { distributorId: String(account.distributor), message };
    broadcast('distributor:inbox-message', event);
    io.to(`mobile:${account._id}`).emit('distributor:inbox-message', event);
    res.status(201).json({ message, updatedAt: inbox.updatedAt });
  } catch (error) { apiError(res, error); }
});

app.get('/api/admin/distributor-inbox', async (_req, res) => {
  try {
    const [accounts, inboxes] = await Promise.all([
      MobileAccount.find({ role: 'distributor', active: true })
        .select('distributor email').populate('distributor', 'name place zone archivedAt').lean(),
      DistributorInbox.find().populate('distributor', 'name place zone').sort({ updatedAt: -1 }).lean()
    ]);
    const inboxByDistributor = new Map(inboxes.map(inbox => [String(inbox.distributor?._id || inbox.distributor), inbox]));
    const conversations = accounts
      .filter(account => account.distributor && !account.distributor.archivedAt)
      .map(account => ({
        distributor: account.distributor,
        email: account.email,
        messages: inboxByDistributor.get(String(account.distributor._id))?.messages || [],
        updatedAt: inboxByDistributor.get(String(account.distributor._id))?.updatedAt || null
      }))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    res.json(conversations);
  } catch (error) { apiError(res, error); }
});

app.post('/api/admin/distributor-inbox/:distributorId/messages', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    if (!mongoose.isValidObjectId(req.params.distributorId)) return res.status(404).json({ error: 'Distributor not found.' });
    const [distributor, account] = await Promise.all([
      Distributor.findOne({ _id: req.params.distributorId, archivedAt: null }).select('name').lean(),
      MobileAccount.findOne({ role: 'distributor', distributor: req.params.distributorId, active: true }).select('_id')
    ]);
    if (!distributor || !account) return res.status(404).json({ error: 'An active distributor login was not found.' });
    const message = {
      sender: 'admin',
      senderName: req.admin.name || 'Operations',
      text,
      sentAt: new Date()
    };
    const inbox = await DistributorInbox.findOneAndUpdate(
      { distributor: req.params.distributorId },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { distributorId: req.params.distributorId, message };
    io.to(`mobile:${account._id}`).emit('distributor:inbox-message', event);
    broadcast('distributor:inbox-message', event);
    res.status(201).json({ message, updatedAt: inbox.updatedAt });
  } catch (error) { apiError(res, error); }
});

app.get('/api/admin/superagent-inbox', async (_req, res) => {
  try {
    const [accounts, inboxes] = await Promise.all([
      MobileAccount.find({ role: 'superagent' }).select('name email active').lean(),
      SuperagentInbox.find().sort({ updatedAt: -1 }).lean()
    ]);
    const inboxBySuperagent = new Map(inboxes.map(inbox => [String(inbox.superagent), inbox]));
    res.json(accounts.map(account => {
      const inbox = inboxBySuperagent.get(String(account._id));
      return {
        superagent: { _id: account._id, name: account.name, email: account.email, active: account.active },
        messages: inbox?.messages || [],
        updatedAt: inbox?.updatedAt || null
      };
    }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)));
  } catch (error) { apiError(res, error); }
});

app.get('/api/superagent/inbox', async (req, res) => {
  try {
    const inbox = await SuperagentInbox.findOne({ superagent: req.mobile.account._id }).select('messages updatedAt').lean();
    res.json(inbox || { messages: [], updatedAt: null });
  } catch (error) { apiError(res, error); }
});

app.post('/api/superagent/inbox', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    const account = req.mobile.account;
    const message = { sender: 'superagent', senderName: account.name, text, sentAt: new Date() };
    const inbox = await SuperagentInbox.findOneAndUpdate(
      { superagent: account._id },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { superagentId: String(account._id), message };
    broadcast('superagent:inbox-message', event);
    io.to(`mobile:${account._id}`).emit('superagent:inbox-message', event);
    res.status(201).json({ message, updatedAt: inbox.updatedAt });
  } catch (error) { apiError(res, error); }
});

app.post('/api/admin/superagent-inbox/:superagentId/messages', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    if (!mongoose.isValidObjectId(req.params.superagentId)) return res.status(404).json({ error: 'Superagent not found.' });
    const account = await MobileAccount.findOne({ _id: req.params.superagentId, role: 'superagent' }).select('name active');
    if (!account) return res.status(404).json({ error: 'Superagent not found.' });
    const message = { sender: 'admin', senderName: req.admin.name || 'Operations', text, sentAt: new Date() };
    const inbox = await SuperagentInbox.findOneAndUpdate(
      { superagent: account._id },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { superagentId: String(account._id), message };
    io.to(`mobile:${account._id}`).emit('superagent:inbox-message', event);
    broadcast('superagent:inbox-message', event);
    res.status(201).json({ message, updatedAt: inbox.updatedAt });
  } catch (error) { apiError(res, error); }
});

app.post('/api/superagent/agents', async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const updates = adminProfileInput(req.body, 'agent');
    if (updates.location) return res.status(400).json({ error: 'Agent locations are managed from the agent’s GPS sharing.' });
    let agent;
    await session.withTransaction(async () => {
      const [created] = await Agent.create([{
        ...updates,
        agent_id: crypto.randomUUID(),
        agentType: 'mobile',
        agent_type: 'mobile',
        floatBalance: 0,
        current_float: 0,
        floatReference: 0,
        safeThreshold: sosThreshold,
        status: 'at_risk',
        lastSeenAt: new Date()
      }], { session });
      agent = created;
      const assignment = await MobileAccount.updateOne(
        { _id: req.mobile.account._id, role: 'superagent', active: true },
        { $addToSet: { managedAgents: agent._id } },
        { session }
      );
      if (assignment.matchedCount !== 1) {
        const error = new Error('Your Superagent account is no longer active.');
        error.status = 401;
        throw error;
      }
    });
    broadcast('agent:telemetry', agent);
    res.status(201).json(agent);
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
});

app.patch('/api/superagent/agents/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) ||
        !req.mobile.account.managedAgents.some(id => String(id) === req.params.id)) {
      return res.status(404).json({ error: 'Agent not found in your assigned network.' });
    }
    const updates = adminProfileInput(req.body, 'agent');
    if (updates.location) return res.status(400).json({ error: 'Agent locations are managed from the agent’s GPS sharing.' });
    const agent = await Agent.findOneAndUpdate(
      { _id: req.params.id, archivedAt: null },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!agent) return res.status(404).json({ error: 'Agent not found in your assigned network.' });
    broadcast('agent:telemetry', agent);
    res.json(agent);
  } catch (error) { apiError(res, error); }
});

app.get('/api/superagent/deletion-requests', async (req, res) => {
  try {
    const requests = await SuperagentDeletionRequest.find({ superagent: req.mobile.account._id })
      .populate('agent', 'name agent_id place zone floatBalance archivedAt')
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json(requests);
  } catch (error) { apiError(res, error); }
});

app.post('/api/superagent/agents/:id/deletion-requests', async (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 500) return res.status(400).json({ error: 'Give a reason between 1 and 500 characters.' });
    if (!mongoose.isValidObjectId(req.params.id) ||
        !req.mobile.account.managedAgents.some(id => String(id) === req.params.id)) {
      return res.status(404).json({ error: 'Agent not found in your assigned network.' });
    }
    const agent = await Agent.findOne({ _id: req.params.id, archivedAt: null }).select('_id').lean();
    if (!agent) return res.status(404).json({ error: 'Agent not found or already deleted.' });
    const request = await SuperagentDeletionRequest.create({
      agent: agent._id,
      superagent: req.mobile.account._id,
      reason
    });
    const populated = await SuperagentDeletionRequest.findById(request._id)
      .populate('agent', 'name agent_id place zone floatBalance')
      .populate('superagent', 'name email').lean();
    broadcast('superagent:deletion-request', populated);
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'A deletion request for this agent is already pending.' });
    apiError(res, error);
  }
});

app.get('/api/admin/superagent-deletion-requests', requireAdmin, async (_req, res) => {
  try {
    const requests = await SuperagentDeletionRequest.find()
      .populate('agent', 'name agent_id place zone floatBalance archivedAt')
      .populate('superagent', 'name email')
      .sort({ status: 1, createdAt: -1 }).limit(500).lean();
    res.json(requests);
  } catch (error) { apiError(res, error); }
});

app.patch('/api/admin/superagent-deletion-requests/:id', requireAdmin, async (req, res) => {
  const { status, reviewNote = '' } = req.body || {};
  const note = typeof reviewNote === 'string' ? reviewNote.trim() : '';
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Choose approved or rejected.' });
  if (note.length > 500) return res.status(400).json({ error: 'Review reason must be no more than 500 characters.' });
  if (status === 'rejected' && !note) return res.status(400).json({ error: 'Give a reason for rejecting this deletion request.' });
  const session = await mongoose.startSession();
  try {
    let request;
    let agent;
    let account;
    await session.withTransaction(async () => {
      request = await SuperagentDeletionRequest.findOne({ _id: req.params.id, status: 'pending' }).session(session);
      if (!request) {
        const error = new Error('Pending deletion request not found; it may already have been reviewed.');
        error.status = 409;
        throw error;
      }
      if (status === 'approved') {
        const activeDispatch = await Dispatch.exists({
          agent: request.agent, status: { $in: ['assigned', 'en_route'] }
        }).session(session);
        if (activeDispatch) {
          const error = new Error('Complete or cancel active dispatches before approving this deletion.');
          error.status = 409;
          throw error;
        }
        agent = await Agent.findOne({ _id: request.agent, archivedAt: null }).session(session);
        if (!agent) {
          const error = new Error('The requested agent is no longer active.');
          error.status = 409;
          throw error;
        }
        agent.archivedAt = new Date();
        agent.status = 'offline';
        await agent.save({ session });
        await Alert.updateMany(
          { agent: agent._id, state: { $in: ['open', 'dispatched'] } },
          { $set: { state: 'resolved', resolved_status: true, resolvedAt: new Date() } },
          { session }
        );
        account = await MobileAccount.findOne({ role: 'agent', agent: agent._id }).session(session);
        if (account) {
          account.active = false;
          account.sessionVersion += 1;
          await account.save({ session });
        }
      }
      request.status = status;
      request.reviewNote = note;
      request.reviewedAt = new Date();
      await request.save({ session });
    });
    if (account) io.in(`mobile:${account._id}`).disconnectSockets(true);
    if (agent) broadcast('agent:telemetry', agent);
    const populated = await SuperagentDeletionRequest.findById(request._id)
      .populate('agent', 'name agent_id place zone floatBalance archivedAt')
      .populate('superagent', 'name email').lean();
    io.to(`mobile:${request.superagent}`).emit('superagent:deletion-request-updated', populated);
    broadcast('superagent:deletion-request-updated', populated);
    res.json(populated);
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
});

app.get('/api/agents', async (req, res) => {
  try {
    const query = req.query.includeArchived === 'true' ? {} : { archivedAt: null };
    if (req.mobile?.account.role === 'superagent') {
      query.archivedAt = null;
      query._id = { $in: req.mobile.account.managedAgents };
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.zone) query.zone = req.query.zone;
    if (req.query.atRisk === 'true') query.status = 'at_risk';
    const agents = await Agent.find(query).sort({ floatBalance: 1 }).limit(1000).lean();
    const agentIds = agents.map(agent => agent._id);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sales = await Transaction.aggregate([
      { $match: { agent: { $in: agentIds }, kind: 'ticket_sale', occurredAt: { $gte: since } } },
      { $group: { _id: '$agent', amount: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]);
    const usageByAgent = new Map(sales.map(item => [String(item._id), item]));
    const accounts = await MobileAccount.find({ role: 'agent', agent: { $in: agentIds } }).select('agent email active').lean();
    const accountByAgent = new Map(accounts.map(account => [String(account.agent), account]));
    res.json(agents.map(agent => {
      const usage = usageByAgent.get(String(agent._id));
      const account = accountByAgent.get(String(agent._id));
      return { ...agent, mobileEmail: account?.email || '', mobileLoginActive: account?.active || false, commuterSales30d: usage?.amount || 0, commuterTransactions30d: usage?.count || 0 };
    }));
  } catch (error) { apiError(res, error); }
});

app.patch('/api/agents/:id/profile', async (req, res) => {
  try {
    const updates = mobileProfileUpdates(req.body);
    const agent = await Agent.findOneAndUpdate(mobileEntityQuery(req, req.params.id, 'agent_id'), { $set: updates }, { new: true, runValidators: true });
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    broadcast('agent:telemetry', agent);
    res.json(agent);
  } catch (error) { apiError(res, error); }
});

app.get('/api/commuter/nearby', async (req, res) => {
  try {
    const longitude=Number(req.query.longitude),latitude=Number(req.query.latitude),radius=Math.max(100,Math.min(Number(req.query.radius)||5000,50000));
    const center={type:'Point',coordinates:[longitude,latitude]};
    if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||!validPoint(center))return res.status(400).json({error:'Valid longitude and latitude are required.'});
    const activeSince = new Date(Date.now() - 15 * 60 * 1000);
    const activeQuery={archivedAt:null,status:{$in:['active','at_risk']},lastSeenAt:{$gte:activeSince},floatBalance:{$gt:0}};
    const nearbyQuery={...activeQuery,location:{$nearSphere:{$geometry:center,$maxDistance:radius}}};
    const [agents,countResult]=await Promise.all([
      Agent.find(nearbyQuery).select('name place zone location floatBalance floatReference safeThreshold lastSeenAt').limit(100).lean(),
      Agent.aggregate([
        {$geoNear:{near:center,distanceField:'distanceMeters',maxDistance:radius,spherical:true,query:activeQuery}},
        {$count:'count'}
      ])
    ]);
    const count=countResult[0]?.count||0;
    const sessionId=String(req.query.sessionId||crypto.randomUUID()).slice(0,100);
    await CommuterLog.create({session_id:sessionId,geo_search_center:center,viewed_agents:agents.map(agent=>agent._id)});
    await OperationalEvent.create({event_id:crypto.randomUUID(),action_type:'commuter_search',actor_id:sessionId,metadata:{center,radius,resultCount:count}});
    res.json({
      sessionId, center, radiusMeters: radius, activeWindowMinutes: 15, count,
      agents: agents.map(agent => {
        const { floatBalance, floatReference, safeThreshold, ...publicAgent } = agent;
        const threshold = Math.max(Number(safeThreshold) || Number(process.env.SOS_THRESHOLD_GBP || 40), 10000, (Number(floatReference) || 0) * 0.1);
        const liquidityLevel = floatBalance <= threshold ? 'low' : floatBalance <= threshold * 2 ? 'medium' : 'high';
        return {
          _id: publicAgent._id,
          name: publicAgent.name,
          place: publicAgent.place,
          zone: publicAgent.zone,
          location: publicAgent.location,
          lastSeenAt: publicAgent.lastSeenAt,
          liquidityLevel,
          distanceMeters: haversineMeters(center.coordinates, agent.location.coordinates)
        };
      })
    });
  }catch(error){apiError(res,error)}
});

app.post('/api/distributors', async(req,res)=>{
  try{
    const {name,location,distributorId}=req.body;
    if(!name||!validPoint(location))return res.status(400).json({error:'name and valid GeoJSON location are required.'});
    const distributor=await Distributor.create({name,full_name:name,distributor_id:distributorId||crypto.randomUUID(),location,live_location:location,status:'available',duty_state:'active'});
    res.status(201).json(distributor);
  }catch(error){apiError(res,error)}
});

app.get('/api/distributors',async(req,res)=>{
  try{
    const query=req.query.includeArchived==='true'?{}:{archivedAt:null};
    if(req.query.status)query.status=req.query.status;
    const distributors=await Distributor.find(query).sort({status:1,name:1}).limit(1000).lean();
    const accounts=await MobileAccount.find({role:'distributor',distributor:{$in:distributors.map(item=>item._id)}}).select('distributor email active').lean();
    const accountByDistributor=new Map(accounts.map(account=>[String(account.distributor),account]));
    res.json(distributors.map(distributor=>{const account=accountByDistributor.get(String(distributor._id));return{...distributor,mobileEmail:account?.email||'',mobileLoginActive:account?.active||false}}));
  }
  catch(error){apiError(res,error)}
});

app.patch('/api/distributors/:id/profile',async(req,res)=>{
  try{
    const updates=mobileProfileUpdates(req.body);
    if(updates.name)updates.full_name=updates.name;
    const distributor=await Distributor.findOneAndUpdate(mobileEntityQuery(req,req.params.id,'distributor_id'),{$set:updates},{new:true,runValidators:true});
    if(!distributor)return res.status(404).json({error:'Distributor not found.'});
    broadcast('distributor:location',distributor);res.json(distributor);
  }catch(error){apiError(res,error)}
});

app.get('/api/distributors/:id/tasks',async(req,res)=>{
  try{
    const distributor=await Distributor.findOne(mobileEntityQuery(req,req.params.id,'distributor_id'));
    if(!distributor)return res.status(404).json({error:'Distributor not found.'});
    const tasks=await Dispatch.find({distributor:distributor._id,status:{$in:['assigned','en_route']}}).sort({assignedAt:1}).populate('agent','name phone place zone location floatBalance').populate('alert','message balanceAtTrigger triggeredAt').lean();
    res.json(tasks);
  }catch(error){apiError(res,error)}
});

app.patch('/api/distributors/:id/location',async(req,res)=>{
  try{
    const {location}=req.body;if(!validPoint(location))return res.status(400).json({error:'A valid GeoJSON location is required.'});
    const distributor=await Distributor.findOneAndUpdate(mobileEntityQuery(req,req.params.id,'distributor_id'),{$set:{location,live_location:location,lastSeenAt:new Date(),duty_state:'active'}},{new:true});
    if(!distributor)return res.status(404).json({error:'Distributor not found.'});
    broadcast('distributor:location',distributor);res.json(distributor);
  }catch(error){apiError(res,error)}
});

app.patch('/api/distributors/:id/status',async(req,res)=>{
  try{
    const {status}=req.body;if(!['available','offline'].includes(status))return res.status(400).json({error:'status must be available or offline.'});
    const distributor=await Distributor.findOne(mobileEntityQuery(req,req.params.id,'distributor_id'));if(!distributor)return res.status(404).json({error:'Distributor not found.'});
    if(status==='offline'&&await Dispatch.exists({distributor:distributor._id,status:{$in:['assigned','en_route']}}))return res.status(409).json({error:'Complete active dispatches before going off duty.'});
    const startedNewShift=status==='available'&&(!distributor.dutyStartedAt||distributor.status==='offline');
    if(startedNewShift)distributor.dutyStartedAt=new Date();
    if(distributor.status!=='busy'||status==='offline')distributor.status=status;
    distributor.duty_state=status==='offline'?'inactive':'active';
    await distributor.save();
    broadcast('distributor:location',distributor);
    if(startedNewShift)broadcast('distributor:shift-started',{
      _id:String(distributor._id),name:distributor.name,status:distributor.status,dutyStartedAt:distributor.dutyStartedAt
    });
    res.json(distributor);
  }catch(error){apiError(res,error)}
});

app.patch('/api/agents/:id/status',async(req,res)=>{
  try{
    const {availability}=req.body;if(!['active','offline'].includes(availability))return res.status(400).json({error:'availability must be active or offline.'});
    const agent=await Agent.findOne(mobileEntityQuery(req,req.params.id,'agent_id'));if(!agent)return res.status(404).json({error:'Agent not found.'});
   const now=new Date();
   if(availability==='active'){
     if(!agent.shiftStartedAt)agent.shiftStartedAt=now;
     agent.status=agent.floatBalance<=lowFloatThreshold(agent)?'at_risk':'active';
   }else{
     if(agent.shiftStartedAt){
       agent.lastShiftSeconds=Math.max(0,Math.floor((now.getTime()-new Date(agent.shiftStartedAt).getTime())/1000));
       agent.shiftSeconds=(Number(agent.shiftSeconds)||0)+agent.lastShiftSeconds;
       agent.shiftStartedAt=null;
     }
     agent.status='offline';
   }
   await agent.save();broadcast('agent:telemetry',agent);res.json(agent);
  }catch(error){apiError(res,error)}
});

app.post('/api/agents', async (req, res) => {
  try {
    const { name, location, floatBalance, zone, place, deviceId, agentId, agentType='mobile' } = req.body;
    if (!name || !validPoint(location) || !Number.isFinite(floatBalance) || floatBalance < 0) return res.status(400).json({ error: 'name, a GeoJSON location, and a non-negative floatBalance are required.' });
    if(!['mobile','fixed'].includes(agentType))return res.status(400).json({error:'agentType must be mobile or fixed.'});
    const agent = await Agent.create({ name, agent_id:agentId||crypto.randomUUID(), agentType,agent_type:agentType,location, floatBalance,current_float:floatBalance,floatReference:floatBalance, zone, place, deviceId, safeThreshold: sosThreshold, status: floatBalance <= Math.max(sosThreshold, 10000, floatBalance * 0.1) ? 'at_risk' : 'active' });
    if (floatBalance <= lowFloatThreshold(agent)) await notifyLowFloat(agent);
    res.status(201).json(agent);
  } catch (error) { apiError(res, error); }
});

async function triggerSos(agent, message = '') {
  const open = await Alert.findOne({ agent: agent._id, state: { $in: ['open', 'dispatched'] } });
  let alert = open;
  let shouldNotify = !open;
  if (alert) {
    if (message) {
      shouldNotify = true;
      alert.message = message;
      await alert.save();
    }
  } else {
    alert = await Alert.create({
      alert_id: crypto.randomUUID(), agent: agent._id, balanceAtTrigger: agent.floatBalance,
      location: agent.location, severity: agent.floatBalance <= 0 ? 'critical' : 'warning', message
    });
    await OperationalEvent.create({
      event_id: crypto.randomUUID(), action_type: 'alert_trigger', actor_id: String(agent._id),
      metadata: { alertId: String(alert._id), balance: agent.floatBalance, location: agent.location, message }
    });
  }
  if (shouldNotify) {
    broadcast('sos:created', {
      alert, agent: { _id: agent._id, name: agent.name, place: agent.place, zone: agent.zone, floatBalance: agent.floatBalance, location: agent.location }
    });
  }
  return await Alert.findById(alert._id) || alert;
}

function lowFloatAlertMessage(agent) {
  const amount = Number(agent.floatBalance).toLocaleString('en-GB');
  const threshold = lowFloatThreshold(agent).toLocaleString('en-GB');
  return `Automatic low-float alert: £${amount} remains (low-float threshold £${threshold}). Please arrange a float transfer.`;
}

async function notifyLowFloat(agent) {
  const open = await Alert.findOne({ agent: agent._id, state: { $in: ['open', 'dispatched'] } }).select('message').lean();
  return triggerSos(agent, open?.message ? '' : lowFloatAlertMessage(agent));
}

app.post('/api/admin/agents/:id/dispatch', async (req, res) => {
  try {
    const instructions = normalizeDispatchInstructions(req.body?.instructions) ||
      'Please transfer float to this agent and record the amount delivered in the app.';
    const distributorId = normalizeDispatchDistributorId(req.body?.distributorId);
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Agent not found.' });
    const agent = await Agent.findOne({ _id: req.params.id, archivedAt: null });
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    if (!validPoint(agent.location)) return res.status(409).json({ error: 'This agent needs a valid location before a distributor can be matched.' });

    const alert = await Alert.findOne({ agent: agent._id, state: { $in: ['open', 'dispatched'] } }) ||
      await triggerSos(agent, 'Manual dispatch requested by an administrator.');
    const dispatch = await assignNearestDistributor(alert._id, instructions, distributorId);
    if (!dispatch) { const error = new Error('No dispatch assignment was created for this alert.'); error.status = 409; throw error; }
    broadcast('dispatch:created', dispatch);
    res.status(201).json(dispatch);
  } catch (error) { apiError(res, error); }
});

async function resolveAgentAlerts(agent){
  const session=await mongoose.startSession();
  try{
    const updates=[];
    await session.withTransaction(async()=>{
      const alerts=await Alert.find({agent:agent._id,state:{$in:['open','dispatched']}}).session(session);
      for(const alert of alerts){
        alert.state='resolved';alert.resolved_status=true;alert.resolvedAt=new Date();await alert.save({session});
        const dispatch=await Dispatch.findOne({alert:alert._id,status:{$in:['assigned','en_route']}}).session(session);
        if(dispatch){dispatch.status='cancelled';await dispatch.save({session});const distributor=await Distributor.findById(dispatch.distributor).session(session);if(distributor){distributor.status='available';distributor.duty_state='active';distributor.assigned_tasks.pull(dispatch._id);await distributor.save({session})}updates.push(dispatch._id)}
      }
      if(alerts.length)await OperationalEvent.create([{event_id:crypto.randomUUID(),action_type:'dispatch_cancelled',actor_id:String(agent._id),metadata:{reason:'agent_balance_recovered',agentId:String(agent._id),cancelledDispatches:updates.map(String)}}],{session});
    });
    for(const id of updates){const dispatch=await Dispatch.findById(id).populate([{path:'agent',select:'name place zone location floatBalance'},{path:'distributor',select:'name location'}]);if(dispatch)broadcast('dispatch:updated',dispatch)}
  }finally{await session.endSession()}
}

// Agent devices update GPS here. Float is maintained by recorded sales and distributor top-ups.
app.post('/api/agents/:id/telemetry', async (req, res) => {
  try {
    const { location } = req.body;
    if (!validPoint(location)) return res.status(400).json({ error: 'A valid GeoJSON location is required.' });
    const agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id'));
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const now = new Date();
    agent.location = location;
    if (!agent.shiftStartedAt) agent.shiftStartedAt = now;
    agent.lastSeenAt = now;
    agent.last_updated = agent.lastSeenAt;
    agent.status = agent.floatBalance <= lowFloatThreshold(agent) ? 'at_risk' : 'active';
    await agent.save();
    broadcast('agent:telemetry', agent);
    const alert = agent.floatBalance <= lowFloatThreshold(agent) ? await notifyLowFloat(agent) : null;
    if (!alert && agent.floatBalance > lowFloatThreshold(agent)) await resolveAgentAlerts(agent);
    res.json({ agent, sos: alert ? { triggered: true, alertId: alert._id } : { triggered: false } });
  } catch (error) { apiError(res, error); }
});

app.post('/api/agents/:id/ticket-sales', async (req, res) => {
  const amount = Number(req.body?.amount);
  const location = req.body?.location;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a positive ticket-sale amount.' });
  if (!validPoint(location)) return res.status(400).json({ error: 'A valid GPS location is required to record the sale.' });
  const session = await mongoose.startSession();
  try {
    let agent;
    await session.withTransaction(async () => {
      agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id')).session(session);
      if (!agent) {
        const error = new Error('Agent not found.');
        error.status = 404;
        throw error;
      }
      if (agent.floatBalance < amount) {
        const error = new Error('The sale amount cannot exceed your available float.');
        error.status = 409;
        throw error;
      }
      if (!Number.isFinite(agent.floatReference) || agent.floatReference <= 0) agent.floatReference = agent.floatBalance;
      agent.floatBalance -= amount;
      agent.current_float = agent.floatBalance;
      agent.location = location;
      agent.lastSeenAt = new Date();
      agent.last_updated = agent.lastSeenAt;
      agent.status = agent.floatBalance <= lowFloatThreshold(agent) ? 'at_risk' : 'active';
      await agent.save({ session });
      await Transaction.create([{
        agent: agent._id, amount, kind: 'ticket_sale', location, occurredAt: new Date()
      }], { session });
    });
    broadcast('agent:telemetry', agent);
    const sos = agent.floatBalance <= lowFloatThreshold(agent)
      ? await notifyLowFloat(agent)
      : null;
    res.status(201).json({
      agent,
      sale: { amount, recordedAt: new Date() },
      sos: sos ? { triggered: true, alertId: sos._id } : { triggered: false }
    });
  } catch (error) {
    apiError(res, error);
  } finally {
    await session.endSession();
  }
});

function receiveBankSlip(req, res, next) {
  bankSlipUpload.single('bankSlip')(req, res, error => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: error.message || 'Unable to receive the bank-slip image.' });
  });
}

function bankSlipMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

app.get('/api/agents/:id/float-settlements', async (req, res) => {
  try {
    const agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id')).select('_id');
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const reports = await FloatSettlement.find({ agent: agent._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json(reports);
  } catch (error) { apiError(res, error); }
});

app.post('/api/agents/:id/float-settlements', receiveBankSlip, async (req, res) => {
  try {
    const depositAmount = Number(req.body?.depositAmount);
    const bankReference = typeof req.body?.bankReference === 'string' ? req.body.bankReference.trim() : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    if (!Number.isFinite(depositAmount) || depositAmount <= 0) return res.status(400).json({ error: 'Enter the positive amount shown on the bank slip.' });
    if (!bankReference || bankReference.length > 100) return res.status(400).json({ error: 'Enter a bank deposit reference of no more than 100 characters.' });
    if (notes.length > 500) return res.status(400).json({ error: 'Notes must be no more than 500 characters.' });
    if (!req.file || bankSlipMime(req.file.buffer) !== req.file.mimetype) return res.status(400).json({ error: 'A valid bank-slip photo is required.' });

    const session = await mongoose.startSession();
    let report;
    let reportAgentId;
    try {
      await session.withTransaction(async () => {
        const agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id')).select('_id').session(session);
        if (!agent) {
          const error = new Error('Agent not found.');
          error.status = 404;
          throw error;
        }
        reportAgentId = String(agent._id);
        if (await FloatSettlement.exists({ agent: agent._id, status: 'pending' }).session(session)) {
          const error = new Error('You already have a settlement report awaiting admin review.');
          error.status = 409;
          throw error;
        }
        const previous = await FloatSettlement.findOne({ agent: agent._id, status: 'approved' })
          .sort({ periodEnd: -1 }).select('periodEnd').session(session).lean();
        const now = new Date();
        const periodStart = previous?.periodEnd || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const sales = await Transaction.aggregate([
          { $match: { agent: agent._id, kind: 'ticket_sale', occurredAt: { $gte: periodStart, $lte: now } } },
          { $group: { _id: null, usedFloat: { $sum: '$amount' } } }
        ]).session(session);
        [report] = await FloatSettlement.create([{
          agent: agent._id,
          periodStart,
          periodEnd: now,
          usedFloat: sales[0]?.usedFloat || 0,
          depositAmount,
          bankReference,
          notes,
          proofData: req.file.buffer,
          proofMimeType: req.file.mimetype
        }], { session });
        await OperationalEvent.create([{
          event_id: crypto.randomUUID(),
          action_type: 'float_settlement_submitted',
          actor_id: String(req.mobile.account._id),
          metadata: { settlementId: String(report._id), agentId: String(agent._id), usedFloat: report.usedFloat, depositAmount }
        }], { session });
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'You already have a settlement report awaiting admin review.' });
      throw error;
    } finally { await session.endSession(); }
    broadcast('float-settlement:created', { _id: report._id, agent: reportAgentId, status: report.status });
    const publicReport = report.toObject();
    delete publicReport.proofData;
    res.status(201).json(publicReport);
  } catch (error) { apiError(res, error); }
});

app.get('/api/float-settlements', async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
    const reports = await FloatSettlement.find(status ? { status } : {})
      .sort({ createdAt: -1 }).limit(500)
      .populate('agent', 'name agent_id place zone floatBalance').lean();
    res.json(reports);
  } catch (error) { apiError(res, error); }
});

app.get('/api/float-settlements/:id/bank-slip', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Settlement report not found.' });
    const report = await FloatSettlement.findById(req.params.id).select('+proofData proofMimeType');
    if (!report) return res.status(404).json({ error: 'Settlement report not found.' });
    res.set({ 'Content-Type': report.proofMimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(report.proofData);
  } catch (error) { apiError(res, error); }
});

app.patch('/api/float-settlements/:id', async (req, res) => {
  const { status, reviewNote = '' } = req.body || {};
  const note = typeof reviewNote === 'string' ? reviewNote.trim() : '';
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved or rejected.' });
  if (note.length > 500) return res.status(400).json({ error: 'Review note must be no more than 500 characters.' });
  if (status === 'rejected' && !note) return res.status(400).json({ error: 'Provide a reason so the agent knows how to correct the report.' });
  if (status === 'approved' && (!Number.isFinite(req.body.amountAdded) || req.body.amountAdded <= 0)) {
    return res.status(400).json({ error: 'Enter the verified float amount to credit.' });
  }

  const session = await mongoose.startSession();
  try {
    let updated;
    let creditedAgent;
    await session.withTransaction(async () => {
      const report = await FloatSettlement.findOne({ _id: req.params.id, status: 'pending' }).session(session);
      if (!report) {
        const error = new Error('Pending settlement report not found; it may already have been reviewed.');
        error.status = 409;
        throw error;
      }
      if (status === 'approved') {
        if (req.body.amountAdded > report.depositAmount) {
          const error = new Error('The credited float cannot exceed the bank deposit amount.');
          error.status = 400;
          throw error;
        }
        creditedAgent = await Agent.findById(report.agent).session(session);
        if (!creditedAgent) {
          const error = new Error('Agent for this settlement report no longer exists.');
          error.status = 409;
          throw error;
        }
        const previousFloat = creditedAgent.floatBalance;
        if (!Number.isFinite(creditedAgent.floatReference) || creditedAgent.floatReference <= 0) creditedAgent.floatReference = previousFloat;
        creditedAgent.floatBalance += req.body.amountAdded;
        creditedAgent.current_float = creditedAgent.floatBalance;
        creditedAgent.floatReference += req.body.amountAdded;
        creditedAgent.lastSeenAt = new Date();
        creditedAgent.last_updated = creditedAgent.lastSeenAt;
        creditedAgent.status = creditedAgent.floatBalance <= lowFloatThreshold(creditedAgent) ? 'at_risk' : 'active';
        await creditedAgent.save({ session });
        const [transaction] = await Transaction.create([{
          agent: creditedAgent._id,
          amount: req.body.amountAdded,
          kind: 'float_top_up',
          settlement: report._id,
          location: creditedAgent.location
        }], { session });
        report.approvedFloat = req.body.amountAdded;
        report.creditedTransaction = transaction._id;
      }
      report.status = status;
      report.reviewedBy = req.admin.sub;
      report.reviewedAt = new Date();
      report.reviewNote = note;
      await report.save({ session });
      await OperationalEvent.create([{
        event_id: crypto.randomUUID(),
        action_type: status === 'approved' ? 'float_settlement_approved' : 'float_settlement_rejected',
        actor_id: req.admin.sub,
        metadata: {
          settlementId: String(report._id),
          agentId: String(report.agent),
          approvedFloat: report.approvedFloat,
          bankReference: report.bankReference,
          reviewNote: report.reviewNote
        }
      }], { session });
      updated = report;
    });
    if (creditedAgent) {
      broadcast('agent:telemetry', creditedAgent);
      if (creditedAgent.floatBalance > lowFloatThreshold(creditedAgent)) await resolveAgentAlerts(creditedAgent);
      else await notifyLowFloat(creditedAgent);
    }
    broadcast('float-settlement:updated', updated);
    res.json(await FloatSettlement.findById(updated._id).populate('agent', 'name agent_id place zone floatBalance').lean());
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
});

app.post('/api/agents/:id/support', async (req, res) => {
  try {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const location = req.body?.location;
    if (message.length > 500) return res.status(400).json({ error: 'Support message must be no more than 500 characters.' });
    if (!validPoint(location)) return res.status(400).json({ error: 'A current GPS location is required to request float support.' });
    const agent = await Agent.findOneAndUpdate(
      mobileEntityQuery(req, req.params.id, 'agent_id'),
      { $set: { location, lastSeenAt: new Date(), last_updated: new Date() } },
      { new: true }
    );
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const alert = await triggerSos(agent, message || 'Agent requested float support.');
    const dispatch = await Dispatch.findOne({ alert: alert._id, status: { $in: ['assigned', 'en_route'] } })
      .populate('distributor', 'name phone location status').lean();
    res.status(202).json({
      alert: { id: String(alert._id), state: alert.state, message: alert.message },
      distributor: dispatch?.distributor || null
    });
  } catch (error) { apiError(res, error); }
});

app.get('/api/alerts', async (req, res) => {
  try {
    const state = req.query.state || 'open';
    const alerts = await Alert.find({ state }).sort({ triggeredAt: -1 }).populate('agent', 'name place zone floatBalance location').limit(500).lean();
    res.json(alerts);
  } catch (error) { apiError(res, error); }
});

app.get('/api/agent-messages', async (_req, res) => {
  try {
    const messages = await Alert.find({ message: { $exists: true, $nin: ['', null] } })
      .sort({ triggeredAt: -1 })
      .populate('agent', 'name phone place zone floatBalance')
      .limit(200)
      .lean();
    res.json(messages);
  } catch (error) { apiError(res, error); }
});

// Candidate matching prefers an agent's zone, then uses route time or distance.
function normalizeDispatchInstructions(value) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim().length > 500) {
    const error = new Error('Distributor instructions must be no more than 500 characters.');
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function normalizeDispatchDistributorId(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) {
    const error = new Error('Select a valid available distributor.');
    error.status = 400;
    throw error;
  }
  return value;
}

async function assignNearestDistributor(alertId, instructions = '', selectedDistributorId = '') {
  const initialAlert=await Alert.findById(alertId);
  if(!initialAlert){const error=new Error('Alert not found.');error.status=404;throw error}
  if(initialAlert.state==='dispatched') {
    let dispatch = await Dispatch.findOne({alert:initialAlert._id});
    if (selectedDistributorId && dispatch && String(dispatch.distributor) !== String(selectedDistributorId)) {
      const error = new Error('This alert already has a distributor assigned.');
      error.status = 409;
      throw error;
    }
    if (dispatch && instructions) {
      dispatch.instructions = instructions;
      await dispatch.save();
    }
    if (!dispatch) return null;
    await dispatch.populate([{path:'agent',select:'name place zone location'},{path:'distributor',select:'name phone location'},{path:'alert',select:'message'}]);
    if (instructions) {
      try { await notifyAssignedDistributor(dispatch); }
      catch(error) { console.warn(`Updated distributor instructions could not be delivered for dispatch ${dispatch._id}: ${error.message}`); }
    }
    return dispatch;
  }
  if(initialAlert.state!=='open'){const error=new Error('Alert is no longer open.');error.status=409;throw error}
  const agent=await Agent.findOne({_id:initialAlert.agent,archivedAt:null}).select('name place zone location').lean();
  if(!agent){const error=new Error('Archived agents cannot receive new dispatches.');error.status=409;throw error}
  const dispatchLocation=validPoint(agent.location)?agent.location:initialAlert.location;
  const candidates=await getDispatchDistributorOptions(agent,dispatchLocation);
  const selected=candidates.find(candidate=>String(candidate._id)===String(selectedDistributorId))||(!selectedDistributorId&&candidates[0]);
  if(!selected){const error=new Error(selectedDistributorId?'The selected distributor is no longer available for this dispatch. Refresh matches and select another distributor.':'No on-duty distributor with an active mobile login and GPS updated within 15 minutes is within 500 m.');error.status=409;throw error}
  const nearest=selected;
  const session = await mongoose.startSession();
  try {
    let result;
    let newlyAssigned=false;
    await session.withTransaction(async () => {
      const alert = await Alert.findById(alertId).session(session);
      if (!alert) { const err = new Error('Alert not found.'); err.status = 404; throw err; }
      if (alert.state === 'dispatched') {
        result=await Dispatch.findOne({alert:alert._id}).session(session);
        if (selectedDistributorId && result && String(result.distributor) !== String(selectedDistributorId)) {
          const err = new Error('This alert already has a distributor assigned.');
          err.status = 409;
          throw err;
        }
        if (result && instructions) { result.instructions=instructions; await result.save({session}); }
        if (result) await result.populate([{path:'agent',select:'name place zone location'},{path:'distributor',select:'name phone location'},{path:'alert',select:'message'}]);
        return;
      }
      if (alert.state !== 'open') { const err = new Error('Alert is no longer open.'); err.status = 409; throw err; }
      const currentAgent=await Agent.findOne({_id:alert.agent,archivedAt:null}).select('location').session(session);
      if (!currentAgent) { const err = new Error('Archived agents cannot receive new dispatches.'); err.status = 409; throw err; }
      const currentLocation=validPoint(currentAgent.location)?currentAgent.location:alert.location;
      if(!validPoint(currentLocation)){const err=new Error('The agent needs a current GPS location before a distributor can be assigned.');err.status=409;throw err}
      const distributor=await Distributor.findOne({
        _id:nearest._id,status:'available',archivedAt:null,
        lastSeenAt:{$gte:new Date(Date.now()-distributorLocationMaxAgeMs)}
      }).session(session);
      if (!distributor) { const err = new Error('The nearest distributor was assigned concurrently. Retry dispatch to match another team.'); err.status = 409; throw err; }
      if (!validPoint(distributor.location) || haversineMeters(currentLocation.coordinates,distributor.location.coordinates)>dispatchSearchRadiusMeters ||
        !await MobileAccount.exists({role:'distributor',distributor:distributor._id,active:true}).session(session)) {
        const err = new Error('The selected distributor is no longer eligible for this dispatch. Refresh matches and try again.');
        err.status = 409;
        throw err;
      }
      const taskInstructions=instructions||`URGENT float transfer for ${agent.name||'the agent'}${agent.place||agent.zone?` (${agent.place||agent.zone})`:''}. Please contact the agent now, confirm the amount needed, arrange the transfer as soon as possible, and record the actual amount delivered in the app.`;
      const [dispatch] = await Dispatch.create([{
        alert: alert._id, agent: alert.agent, distributor: distributor._id,
        instructions:taskInstructions,
        messages:[{sender:'admin',senderName:'Operations',text:taskInstructions}],
        status: 'en_route', distanceMeters: haversineMeters(currentLocation.coordinates, distributor.location.coordinates),
        routeCoordinates:[distributor.location.coordinates,currentLocation.coordinates]
      }], { session });
      newlyAssigned=true;
      distributor.status = 'busy';distributor.duty_state='active';distributor.assigned_tasks.push(dispatch._id); await distributor.save({ session });
      alert.location=currentLocation;alert.state = 'dispatched';alert.assigned_distributor_id=distributor.distributor_id||String(distributor._id); await alert.save({ session });
      await OperationalEvent.create([{event_id:crypto.randomUUID(),action_type:'dispatch_assigned',actor_id:String(distributor._id),metadata:{dispatchId:String(dispatch._id),alertId:String(alert._id),agentId:String(alert.agent),distanceMeters:dispatch.distanceMeters}}],{session});
      result = await dispatch.populate([{ path: 'agent', select: 'name place zone location' }, { path: 'distributor', select: 'name phone location' }, { path: 'alert', select: 'message' }]);
    });
    if(result && result.distributor?.location?.coordinates && result.agent?.location?.coordinates){const route=await getRoute(result.distributor.location.coordinates,result.agent.location.coordinates);await Dispatch.findByIdAndUpdate(result._id,{$set:{routeCoordinates:route.coordinates,routeDistanceMeters:route.distanceMeters,routeDurationSeconds:route.durationSeconds,routeSource:route.source}});result=await Dispatch.findById(result._id).populate([{path:'agent',select:'name place zone location'},{path:'distributor',select:'name phone location'},{path:'alert',select:'message'}]);}
    if(newlyAssigned || (result && instructions)) {
      try { await notifyAssignedDistributor(result); }
      catch(error) { console.warn(`Assigned distributor could not be notified for dispatch ${result._id}: ${error.message}`); }
    }
    return result;
  } finally { await session.endSession(); }
}

async function getDispatchDistributorOptions(agent, location = agent.location) {
  if (!validPoint(location)) {
    const error = new Error('The agent needs a valid location before nearby distributors can be found.');
    error.status = 409;
    throw error;
  }
  const activeAccounts=await MobileAccount.find({role:'distributor',active:true}).select('distributor').lean();
  const eligibleIds=activeAccounts.map(account=>account.distributor).filter(Boolean);
  if(!eligibleIds.length)return [];
  const locationUpdatedSince=new Date(Date.now()-distributorLocationMaxAgeMs);
  const nearby=await Distributor.find({
    _id:{$in:eligibleIds},status:'available',archivedAt:null,
    lastSeenAt:{$gte:locationUpdatedSince},
    location:{$near:{$geometry:location,$maxDistance:dispatchSearchRadiusMeters}}
  }).limit(100).select('name phone place zone location').lean();
  const inZone=nearby.filter(distributor=>agent.zone&&distributor.zone&&distributor.zone.toLowerCase()===agent.zone.toLowerCase());
  const otherZones=nearby.filter(distributor=>!inZone.includes(distributor));
  const prioritized=[...inZone.slice(0,5),...otherZones.slice(0,5)];
  const options=await Promise.all(prioritized.map(async distributor=>{
    const route=await getRoute(distributor.location.coordinates,location.coordinates);
    return {
      ...distributor,
      zoneMatch:inZone.includes(distributor),
      distanceMeters:haversineMeters(location.coordinates,distributor.location.coordinates),
      routeDistanceMeters:route.distanceMeters,
      routeDurationSeconds:route.durationSeconds,
      routeSource:route.source
    };
  }));
  return options.sort((a,b)=>{
    if(a.zoneMatch!==b.zoneMatch)return a.zoneMatch?-1:1;
    if(a.routeDurationSeconds!==null&&b.routeDurationSeconds!==null&&a.routeDurationSeconds!==b.routeDurationSeconds){
      return a.routeDurationSeconds-b.routeDurationSeconds;
    }
    return a.routeDistanceMeters-b.routeDistanceMeters;
  });
}

async function getDispatchAvailabilityDiagnostics(agent, location = agent.location) {
  const activeAccounts=await MobileAccount.find({role:'distributor',active:true}).select('distributor').lean();
  const eligibleIds=[...new Set(activeAccounts.map(account=>String(account.distributor||'')).filter(Boolean))];
  if(!eligibleIds.length)return {activeLogins:0,onDuty:0,recentGps:0,withinRange:0,staleDistributorIds:[]};
  const distributors=await Distributor.find({_id:{$in:eligibleIds}}).select('status archivedAt lastSeenAt location').lean();
  const onDuty=distributors.filter(distributor=>distributor.status==='available'&&!distributor.archivedAt);
  const locationUpdatedSince=Date.now()-distributorLocationMaxAgeMs;
  const recentGps=onDuty.filter(distributor=>validPoint(distributor.location)&&new Date(distributor.lastSeenAt).getTime()>=locationUpdatedSince);
  const recentIds=new Set(recentGps.map(distributor=>String(distributor._id)));
  const withinRange=validPoint(location)
    ? recentGps.filter(distributor=>haversineMeters(location.coordinates,distributor.location.coordinates)<=dispatchSearchRadiusMeters)
    : [];
  return {
    activeLogins:eligibleIds.length,
    onDuty:onDuty.length,
    recentGps:recentGps.length,
    withinRange:withinRange.length,
    staleDistributorIds:onDuty.filter(distributor=>!recentIds.has(String(distributor._id))).map(distributor=>String(distributor._id))
  };
}

app.get('/api/dispatch-options', async (req, res) => {
  try {
    const {agentId,alertId}=req.query;
    if (Boolean(agentId)===Boolean(alertId)) return res.status(400).json({error:'Provide exactly one agentId or alertId.'});
    let agent;
    let location;
    if(alertId){
      const alert=await Alert.findById(alertId).populate('agent','name zone location archivedAt');
      if(!alert)return res.status(404).json({error:'Alert not found.'});
      if(alert.state!=='open')return res.status(409).json({error:'This alert is no longer open.'});
      agent=alert.agent;
      if(!agent||agent.archivedAt)return res.status(409).json({error:'Archived agents cannot receive new dispatches.'});
      location=alert.location;
    }else{
      if(!mongoose.isValidObjectId(agentId))return res.status(404).json({error:'Agent not found.'});
      agent=await Agent.findOne({_id:agentId,archivedAt:null}).select('name zone location').lean();
      if(!agent)return res.status(404).json({error:'Agent not found.'});
      location=agent.location;
      const activeAlert=await Alert.findOne({agent:agent._id,state:'dispatched'}).select('_id').lean();
      if(activeAlert)return res.status(409).json({error:'This agent already has an active dispatch.'});
      const openAlert=await Alert.findOne({agent:agent._id,state:'open'}).select('location').lean();
      if(openAlert?.location)location=openAlert.location;
    }
    location=validPoint(agent.location)?agent.location:location;
    const options=await getDispatchDistributorOptions(agent,location);
    const diagnostics=options.length?undefined:await getDispatchAvailabilityDiagnostics(agent,location);
    if(req.query.refreshGps==='true'&&diagnostics?.staleDistributorIds.length){
      const accounts=await MobileAccount.find({
        role:'distributor',active:true,distributor:{$in:diagnostics.staleDistributorIds}
      }).select('_id distributor').lean();
      for(const account of accounts){
        io.to(`mobile:${account._id}`).emit('distributor:refresh-location-request',{
          distributorId:String(account.distributor)
        });
      }
    }
    if(diagnostics)delete diagnostics.staleDistributorIds;
    res.json({zone:agent.zone||'',options,...(diagnostics?{diagnostics}:{})});
  } catch(error) { apiError(res,error); }
});

app.post('/api/alerts/:id/dispatch', async (req, res) => {
  try{const instructions=normalizeDispatchInstructions(req.body?.instructions);const distributorId=normalizeDispatchDistributorId(req.body?.distributorId);const dispatch=await assignNearestDistributor(req.params.id,instructions,distributorId);broadcast('dispatch:created',dispatch);res.status(201).json(dispatch)}
  catch(error){apiError(res,error)}
});

function haversineMeters([lon1, lat1], [lon2, lat2]) {
  const rad = n => n * Math.PI / 180; const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/api/dispatches', async (req, res) => {
  try {
    const statuses = req.query.status ? req.query.status.split(',') : ['assigned', 'en_route'];
    const completedOnly = statuses.length === 1 && statuses[0] === 'completed';
    const sort = completedOnly ? { completedAt: -1 } : { assignedAt: -1 };
    res.json(await Dispatch.find({ status: { $in: statuses } }).sort(sort).populate('agent', 'name phone place zone location floatBalance').populate('distributor', 'name phone location').populate('alert', 'message balanceAtTrigger triggeredAt').limit(completedOnly ? 50 : 500).lean());
  } catch (error) { apiError(res, error); }
});

app.patch('/api/dispatches/:id', async (req, res) => {
  const session=await mongoose.startSession();
  try {
    const allowed = ['en_route', 'completed', 'cancelled'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}.` });
    if(req.body.status==='completed'&&(!Number.isFinite(req.body.amountAdded)||req.body.amountAdded<=0||Math.round(req.body.amountAdded*100)/100!==req.body.amountAdded))return res.status(400).json({error:'Enter a positive replenishment amount with no more than two decimal places.'});
    let result;
    await session.withTransaction(async()=>{
      const dispatch=await Dispatch.findById(req.params.id).session(session);
      if(!dispatch){const error=new Error('Dispatch not found.');error.status=404;throw error}
      if(String(dispatch.distributor)!==String(req.mobile.account.distributor)){const error=new Error('This dispatch is assigned to another distributor.');error.status=403;throw error}
      if(!['assigned','en_route'].includes(dispatch.status)){const error=new Error('Dispatch is no longer active.');error.status=409;throw error}
      dispatch.status=req.body.status;if(req.body.status==='completed'){dispatch.completedAt=new Date();dispatch.amountAdded=req.body.amountAdded}await dispatch.save({session});
      if(['completed','cancelled'].includes(req.body.status)){
        const distributor=await Distributor.findById(dispatch.distributor).session(session);
        if(distributor){distributor.status='available';distributor.duty_state='active';distributor.assigned_tasks.pull(dispatch._id);await distributor.save({session})}
        if(req.body.status==='completed'){
          const agent=await Agent.findById(dispatch.agent).session(session);
          if(!agent){const error=new Error('Agent for this dispatch no longer exists.');error.status=409;throw error}
          const previous=agent.floatBalance;if(!Number.isFinite(agent.floatReference)||agent.floatReference<=0)agent.floatReference=previous;agent.floatBalance+=req.body.amountAdded;agent.current_float=agent.floatBalance;agent.floatReference+=req.body.amountAdded;agent.status=agent.floatBalance<=lowFloatThreshold(agent)?'at_risk':'active';agent.lastSeenAt=new Date();agent.last_updated=agent.lastSeenAt;await agent.save({session});
          dispatch.floatBalanceAfter=agent.floatBalance;await dispatch.save({session});
          await Transaction.create([{agent:agent._id,amount:req.body.amountAdded,kind:'float_top_up',location:agent.location}],{session});
          await Alert.findByIdAndUpdate(dispatch.alert,{$set:{state:'resolved',resolvedAt:new Date(),resolved_status:true}},{session});
          await OperationalEvent.create([{event_id:crypto.randomUUID(),action_type:'replenish',actor_id:String(dispatch.distributor),metadata:{dispatchId:String(dispatch._id),agentId:String(agent._id),amount_added:req.body.amountAdded,previous_float:previous}},{event_id:crypto.randomUUID(),action_type:'dispatch_completed',actor_id:String(dispatch.distributor),metadata:{dispatchId:String(dispatch._id)}}],{session});
        }
      }
      result=await dispatch.populate([{path:'agent',select:'name place zone location floatBalance'},{path:'distributor',select:'name location'}]);
    });
    if(req.body.status==='completed') {
      broadcast('agent:telemetry',result.agent);
      if (result.agent.floatBalance <= lowFloatThreshold(result.agent)) await notifyLowFloat(result.agent);
    }
    broadcast('dispatch:updated', result);res.json(result);
  } catch (error) { apiError(res, error); }
  finally{await session.endSession()}
});

app.post('/api/dispatches/:id/messages', async (req, res) => {
  try {
    const text=typeof req.body?.text==='string'?req.body.text.trim():'';
    if(!text||text.length>500)return res.status(400).json({error:'Message must be between 1 and 500 characters.'});
    const dispatch=await Dispatch.findById(req.params.id);
    if(!dispatch)return res.status(404).json({error:'Dispatch not found.'});
    if(!['assigned','en_route'].includes(dispatch.status))return res.status(409).json({error:'This dispatch conversation is closed.'});

    let sender;
    let senderName;
    if(req.mobile?.account?.role==='distributor'){
      if(String(dispatch.distributor)!==String(req.mobile.account.distributor))return res.status(403).json({error:'This dispatch belongs to another distributor.'});
      sender='distributor';
      const distributor=await Distributor.findById(req.mobile.account.distributor).select('name').lean();
      senderName=distributor?.name||'Distributor';
    }else{
      sender='admin';
      senderName=req.admin?.name||'Operations';
    }

    dispatch.messages.push({sender,senderName,text});
    while(dispatch.messages.length>100)dispatch.messages.shift();
    await dispatch.save();
    const message=dispatch.messages[dispatch.messages.length-1].toObject();
    const event={dispatchId:String(dispatch._id),message};
    if(sender==='admin'){
      const account=await MobileAccount.findOne({role:'distributor',distributor:dispatch.distributor,active:true}).select('_id').lean();
      if(account)io.to(`mobile:${account._id}`).emit('dispatch:message',event);
    }else{
      broadcast('dispatch:message',event);
    }
    res.status(201).json(event);
  }catch(error){apiError(res,error)}
});

app.get('/api/transactions', async (req, res) => {
  try {
    const since = new Date(Date.now() - Math.min(Number(req.query.hours) || 24, 24 * 30) * 3600000);
    res.json(await Transaction.find({ occurredAt: { $gte: since } }).sort({ occurredAt: -1 }).populate('agent', 'name zone').limit(2000).lean());
  } catch (error) { apiError(res, error); }
});

app.get('/api/liquidity/heatmap', async (req, res) => {
  try {
    const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
    const since = new Date(Date.now() - hours * 3600000);
    const points = await Agent.aggregate([
      { $match: { archivedAt: null, 'location.type':'Point' } },
      { $lookup: { from: 'transactions', let: { agentId: '$_id' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$agent', '$$agentId'] }, { $gte: ['$occurredAt', since] }] } } }, { $group: { _id: '$kind', count: { $sum: 1 }, value: { $sum: '$amount' } } }], as: 'activity' } },
      { $project: { name: 1, zone: 1, location: 1, floatBalance: 1, floatReference: 1, safeThreshold: 1, activity: 1, risk: { $cond: [{ $lte: ['$floatBalance', { $max: [10000, { $ifNull: ['$safeThreshold', 40] }, { $multiply: [{ $ifNull: ['$floatReference', 0] }, 0.1] }] }] }, 'critical', { $cond: [{ $lte: ['$floatBalance', { $multiply: [{ $max: [10000, { $ifNull: ['$safeThreshold', 40] }, { $multiply: [{ $ifNull: ['$floatReference', 0] }, 0.1] }] }, 2] }] }, 'low', 'healthy'] }] } } }
    ]);
    res.json({ generatedAt: new Date(), windowHours: hours, points });
  } catch (error) { apiError(res, error); }
});

app.get('/api/summary', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 3600000);
    const [agents, alerts, distributors, transactionCount, transactionValue] = await Promise.all([
      Agent.aggregate([{ $match: { archivedAt: null } }, { $group: { _id: null, active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } }, total: { $sum: 1 }, liquidity: { $sum: '$floatBalance' }, atRisk: { $sum: { $cond: [{ $eq: ['$status', 'at_risk'] }, 1, 0] } } } }]),
      Alert.countDocuments({ state: { $in: ['open', 'dispatched'] } }), Distributor.countDocuments({ status: 'available' }),
      Transaction.countDocuments({ occurredAt: { $gte: since } }), Transaction.aggregate([{ $match: { occurredAt: { $gte: since } } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
    ]);
    res.json({ agents: agents[0] || { active: 0, total: 0, liquidity: 0, atRisk: 0 }, openAlerts: alerts, availableDistributors: distributors, transactions24h: transactionCount, transactionValue24h: transactionValue[0]?.total || 0, generatedAt: new Date() });
  } catch (error) { apiError(res, error); }
});

app.get('/api/analytics',async(req,res)=>{
  try{
    const days=Math.max(1,Math.min(Number(req.query.days)||7,90));const since=new Date(Date.now()-days*86400000);
    const [timeline,zoneRisks,completed,events]=await Promise.all([
      OperationalEvent.aggregate([{$match:{timestamp:{$gte:since}}},{$group:{_id:{day:{$dateToString:{format:'%Y-%m-%d',date:'$timestamp'}},type:'$action_type'},count:{$sum:1}}},{$sort:{'_id.day':1}}]),
      Agent.aggregate([{$match:{archivedAt:null}},{$group:{_id:'$zone',agents:{$sum:1},float:{$sum:'$floatBalance'},atRisk:{$sum:{$cond:[{$eq:['$status','at_risk']},1,0]}}}},{$sort:{float:1}}]),
      Dispatch.aggregate([{$match:{status:'completed',completedAt:{$gte:since}}},{$project:{minutes:{$divide:[{$subtract:['$completedAt','$assignedAt']},60000]}}},{$group:{_id:null,count:{$sum:1},averageResponseMinutes:{$avg:'$minutes'}}}]),
      OperationalEvent.countDocuments({timestamp:{$gte:since}})
    ]);
    res.json({days,generatedAt:new Date(),timeline,zoneRisks,dispatchResponse:completed[0]||{count:0,averageResponseMinutes:null},eventCount:events});
  }catch(error){apiError(res,error)}
});

app.use('/api',(req,res)=>res.status(404).json({error:'API route not found.'}));

// Client-side React routes fall back to the Vite production entry point.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'), error => { if (error) next(); });
});

io.use(async (socket, next) => {
  try {
    const adminSession = sessionFromRequest(socket.request);
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
      if (agent.floatBalance <= lowFloatThreshold(agent)) await notifyLowFloat(agent);
      else await resolveAgentAlerts(agent);
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
  server.listen(port,()=>console.log(`Tap & Go operations server listening on http://localhost:${port}`));
}

startServer().catch(error => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
