module.exports = (context) => {
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = context;
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
    res.json({ email: profile.email, name: profile.name, expiresAt, expiresIn: 28800, token: issueAdminSession(profile.email, profile.sessionVersion, expiresAt) });
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
    const accountView = await mobileAccountView(account);
    res.json({
      token: issueMobileSession(account, expiresAt),
      expiresAt,
      account: { id: accountView.id, email: accountView.email, role: accountView.role },
      entity: accountView.entity
    });
  } catch (error) { apiError(res, error); }
});
app.post('/api/auth/mobile/activate', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!/^[a-f\d]{64}$/i.test(token)) return res.status(400).json({ error: 'This account setup link is invalid or expired. Ask your administrator to resend it.' });
  if (password.length < 12 || password.length > 1024) return res.status(400).json({ error: 'Password must be at least 12 characters.' });

  const session = await mongoose.startSession();
  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = hashPassword(password);
    let activated = false;
    await session.withTransaction(async () => {
      activated = false;
      const account = await MobileAccount.findOne({
        inviteTokenHash: tokenHash,
        setupPending: true,
        active: true,
        inviteExpiresAt: { $gt: new Date() }
      }).select('+inviteTokenHash').session(session);
      if (!account) return;

      account.passwordHash = passwordHash;
      account.active = true;
      account.setupPending = false;
      account.inviteTokenHash = undefined;
      account.inviteExpiresAt = undefined;
      account.sessionVersion += 1;
      await account.save({ session });

      if (account.role === 'agent' || account.role === 'distributor') {
        const Profile = account.role === 'agent' ? Agent : Distributor;
        const profileId = account.role === 'agent' ? account.agent : account.distributor;
        await Profile.updateOne({ _id: profileId }, { $set: { passwordHash } }, { session });
      }
      activated = true;
    });
    if (!activated) return res.status(400).json({ error: 'This account setup link is invalid or expired. Ask your administrator to resend it.' });
    res.json({ success: true });
  } catch (error) { apiError(res, error); }
  finally { await session.endSession(); }
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
    const accountView = await mobileAccountView(commuter);
    res.status(201).json({
      token: issueMobileSession({ _id: commuter._id, role: 'commuter', sessionVersion: commuter.sessionVersion }, expiresAt),
      expiresAt,
      account: { id: accountView.id, email: accountView.email, role: accountView.role },
      entity: accountView.entity
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
    const accountView = await mobileAccountView(commuter);
    res.json({
      token: issueMobileSession({ _id: commuter._id, role: 'commuter', sessionVersion: commuter.sessionVersion }, expiresAt),
      expiresAt,
      account: { id: accountView.id, email: accountView.email, role: accountView.role },
      entity: accountView.entity
    });
  } catch (error) { apiError(res, error); }
});
app.get('/api/auth/mobile/me', async (req, res, next) => {
  const match = (req.headers.authorization || '').match(/^Bearer\s+(\S+)$/);
  const session = match && verifySignedToken(match[1]);
  if (!session || !['agent', 'distributor', 'superagent', 'commuter'].includes(session.role)) return res.status(401).json({ error: 'Sign in with an active mobile account to continue.' });
  return requireMobile(session.role)(req, res, async () => {
    try {
      res.json(await mobileAccountView(req.mobile.account));
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
  if (mobileSession.role !== 'commuter') {
    return res.status(403).json({ error: 'Staff account details can only be changed by an administrator.' });
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
  const isProduction = process.env.NODE_ENV === 'production';
  const sameSite = isProduction ? 'None' : 'Strict';
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `tapgo_admin_session=; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=0${secure}`);
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
    res.json({ email: profile.email, name: profile.name, expiresAt, token: issueAdminSession(profile.email, profile.sessionVersion, expiresAt) });
  } catch (error) { apiError(res, error); }
});

};
