const crypto = require('crypto');
const { publicIdQuery } = require('./validation');

function createAuthHelpers(context) {
  const {
    authSecret,
    adminEmail,
    adminPassword,
    AdminProfile,
    MobileAccount,
    CommuterAccount,
    Agent,
    Distributor,
    lowFloatThreshold
  } = context;

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
        if (!session || session.role !== role || !require('mongoose').isValidObjectId(session.sub)) {
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

  function sessionFromToken(token) {
    const [payload, signature] = String(token || '').split('.');
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

  function sessionFromRequest(req) {
    const bearer = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
    if (bearer) return sessionFromToken(bearer[1]);
    const match = (req.headers.cookie || '').match(/(?:^|;\s*)tapgo_admin_session=([^;]+)/);
    if (!match) return null;
    try { return sessionFromToken(decodeURIComponent(match[1])); } catch { return null; }
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

  async function mobileAccountView(account) {
    const entity = account.role === 'commuter'
      ? { name: account.name }
      : account.role === 'agent'
        ? await Agent.findById(account.agent).select('name phone place zone location floatBalance floatReference safeThreshold liquidityStatus status agent_id shiftStartedAt shiftSeconds').lean()
        : account.role === 'distributor'
          ? await Distributor.findById(account.distributor).select('name phone place location status distributor_id').lean()
          : { name: account.name };
    if (!entity) throw Object.assign(new Error('The mobile account is no longer linked to a profile.'), { status: 401 });
    return {
      id: String(account._id),
      email: account.email,
      role: account.role,
      entity: account.role === 'agent' ? { ...entity, lowFloatThreshold: lowFloatThreshold(entity) } : entity
    };
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
    const isProduction = process.env.NODE_ENV === 'production';
    const secure = isProduction ? '; Secure' : '';
    const sameSite = isProduction ? 'None' : 'Strict';
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    res.setHeader('Set-Cookie', `tapgo_admin_session=${encodeURIComponent(issueAdminSession(profile.email, profile.sessionVersion, expiresAt))}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=28800${secure}`);
    return expiresAt;
  }

  function apiError(res, error) {
    console.error(error);
    const status = error.status || ((error.name === 'CastError' || error.name === 'ValidationError') ? 400 : (error.code === 11000 ? 409 : 500));
    res.status(status).json({ error: status < 500 ? error.message : 'Internal server error' });
  }

  return {
    issueAdminSession,
    issueMobileSession,
    verifySignedToken,
    requireMobile,
    mobileEntityQuery,
    sessionFromToken,
    sessionFromRequest,
    requireAdmin,
    hashPassword,
    passwordMatchesHash,
    mobileAccountView,
    backfillProfilePasswordHashes,
    passwordMatchesConfig,
    setAdminCookie,
    apiError
  };
}

module.exports = createAuthHelpers;
