module.exports = (context) => {
  const { finishAgentShift, finishDistributorShift } = require('../utils/shifts');
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, notifyLowFloat, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError, createInvitationToken, ensureInvitationConfigured, sendStaffInvitation, sendStaffPasswordReset } = context;
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
        setupPending: account.setupPending,
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
  try {
    const role = req.body?.role;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const recordId = String(req.body?.recordId || '');
    if (!['agent', 'distributor', 'superagent'].includes(role)) return res.status(400).json({ error: 'Choose an agent, distributor, or Superagent role.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    ensureInvitationConfigured();
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
      const invite = createInvitationToken();
      const [superagent] = await MobileAccount.create([{
        role,
        name,
        managedAgents: managedAgentIds,
        email,
        passwordHash: hashPassword(crypto.randomBytes(32).toString('hex')),
        inviteTokenHash: invite.tokenHash,
        inviteExpiresAt: invite.expiresAt,
        setupPending: true
      }]);
      try {
        await sendStaffInvitation({ email, name, role, token: invite.token });
      } catch (error) {
        console.error('Unable to deliver Superagent invitation:', error.message);
        return res.status(502).json({ error: `The account was created, but its invitation email could not be sent. Resend the invitation from this page. ${error.message}`, accountCreated: true, id: String(superagent._id) });
      }
      return res.status(201).json({ id: String(superagent._id), role, name, email, active: superagent.active });
    }
    if (!mongoose.isValidObjectId(recordId)) return res.status(400).json({ error: 'Choose an existing profile.' });
    const Model = role === 'agent' ? Agent : Distributor;
    const invite = createInvitationToken();
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    const record = await Model.findById(recordId).select('_id name');
    if (!record) {
      const error = new Error('The selected profile was not found.');
      error.status = 404;
      throw error;
    }
    const profileName = record.name;
    const account = await MobileAccount.create({
      role,
      [role]: record._id,
      email,
      passwordHash,
      inviteTokenHash: invite.tokenHash,
      inviteExpiresAt: invite.expiresAt,
      setupPending: true
    });
    try {
      await sendStaffInvitation({ email, name: profileName, role, token: invite.token });
    } catch (error) {
      console.error(`Unable to deliver ${role} invitation:`, error.message);
      return res.status(502).json({ error: `The account was created, but its invitation email could not be sent. Resend the invitation from this page. ${error.message}`, accountCreated: true, id: String(account._id) });
    }
    res.status(201).json({ id: String(account._id), role: account.role, email: account.email, active: account.active });
  } catch (error) { apiError(res, error); }
});
app.post('/api/admin/mobile-accounts/:id/invitation', requireAdmin, async (req, res) => {
  try {
    ensureInvitationConfigured();
    const account = await MobileAccount.findOne({ _id: req.params.id, setupPending: true, active: true });
    if (!account) return res.status(404).json({ error: 'No pending account invitation was found.' });
    const invite = createInvitationToken();
    account.inviteTokenHash = invite.tokenHash;
    account.inviteExpiresAt = invite.expiresAt;
    await account.save();
    await sendStaffInvitation({
      email: account.email,
      name: account.name || account.role,
      role: account.role,
      token: invite.token
    });
    res.json({ success: true, email: account.email });
  } catch (error) {
    console.error('Unable to resend mobile account invitation:', error.message);
    res.status(error.status || 502).json({ error: `Unable to send the account invitation. ${error.message}` });
  }
});
app.post('/api/admin/mobile-accounts/:id/password-reset', requireAdmin, async (req, res) => {
  let session;
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Mobile account not found.' });
    ensureInvitationConfigured();
    const invite = createInvitationToken();
    const replacementPasswordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    let account;
    let name;
    let setupPending;
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      account = await MobileAccount.findById(req.params.id).session(session);
      if (!account) {
        const error = new Error('Mobile account not found.');
        error.status = 404;
        throw error;
      }
      if (!account.active) {
        const error = new Error('Enable this mobile account before resetting its password.');
        error.status = 409;
        throw error;
      }
      setupPending = account.setupPending;
      name = account.name || account.role;
      if (account.role === 'agent' || account.role === 'distributor') {
        const Profile = account.role === 'agent' ? Agent : Distributor;
        const profileId = account.role === 'agent' ? account.agent : account.distributor;
        const profile = await Profile.findOne({ _id: profileId, archivedAt: null }).select('name').session(session);
        if (!profile) {
          const error = new Error('The mobile account profile is missing or archived.');
          error.status = 409;
          throw error;
        }
        name = profile.name;
        await Profile.updateOne({ _id: profile._id }, { $set: { passwordHash: replacementPasswordHash } }, { session });
      }
      account.passwordHash = replacementPasswordHash;
      account.inviteTokenHash = invite.tokenHash;
      account.inviteExpiresAt = invite.expiresAt;
      account.setupPending = true;
      account.sessionVersion += 1;
      await account.save({ session });
    });
    await session.endSession();
    session = null;
    io.in(`mobile:${account._id}`).disconnectSockets(true);
    try {
      const sendAccessEmail = setupPending ? sendStaffInvitation : sendStaffPasswordReset;
      await sendAccessEmail({
        email: account.email,
        name,
        role: account.role,
        token: invite.token
      });
    } catch (error) {
      console.error(`Unable to deliver ${account.role} access email:`, error.message);
      return res.status(502).json({ error: `The old password has been revoked, but the access email could not be delivered. Try sending a new link. ${error.message}` });
    }
    res.json({ success: true, email: account.email, setupPending });
  } catch (error) { apiError(res, error); }
  finally { if (session) await session.endSession(); }
});
app.patch('/api/admin/mobile-accounts/:id', requireAdmin, async (req, res) => {
  try {
    const account = await MobileAccount.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Mobile account not found.' });
    if (req.body?.password !== undefined) return res.status(400).json({ error: 'Use the password reset action to email a secure reset link.' });
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
    } else if (req.body?.name !== undefined || req.body?.email !== undefined) {
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
  updates.zone = zone;
  if (role === 'distributor') updates.full_name = name;
  return updates;
}

function mobileCredentialsInput(body = {}) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error('Enter a valid sign-in email address.'), { status: 400 });
  }
  if (password && (password.length < 12 || password.length > 1024)) {
    throw Object.assign(new Error('Password must be at least 12 characters.'), { status: 400 });
  }
  return { email, password };
}

app.post('/api/admin/agents', requireAdmin, async (req, res) => {
  try {
    const { email } = mobileCredentialsInput(req.body);
    const updates = adminProfileInput(req.body, 'agent');
    const [adminExists, commuterExists, existingAccount] = await Promise.all([
      AdminProfile.exists({ email }),
      CommuterAccount.exists({ email }),
      MobileAccount.findOne({ email }).select('+inviteTokenHash')
    ]);
    if (adminExists || commuterExists) return res.status(409).json({ error: 'This email address is already in use by another account.' });
    if (existingAccount) {
      if (existingAccount.role !== 'agent' || !existingAccount.agent) {
        return res.status(409).json({ error: 'This email address is already linked to another mobile account.' });
      }
      const existingAgent = await Agent.findOne({ _id: existingAccount.agent, archivedAt: null });
      if (!existingAgent || !existingAccount.active) {
        return res.status(409).json({ error: 'An inactive or archived Agent account already uses this email. Review the existing account in Settings.' });
      }
      if (existingAccount.setupPending) {
        ensureInvitationConfigured();
        const invite = createInvitationToken();
        existingAccount.inviteTokenHash = invite.tokenHash;
        existingAccount.inviteExpiresAt = invite.expiresAt;
        await existingAccount.save();
        try {
          await sendStaffInvitation({ email, name: existingAgent.name, role: 'agent', token: invite.token });
        } catch (error) {
          console.error('Unable to resend the existing agent invitation:', error.message);
          return res.status(502).json({ error: `The Agent already exists, but its setup email could not be sent. Resend the invitation from Settings. ${error.message}`, accountCreated: true, id: String(existingAccount._id) });
        }
      }
      return res.status(200).json({
        profile: existingAgent,
        account: { id: String(existingAccount._id), role: existingAccount.role, email: existingAccount.email, active: existingAccount.active },
        existing: true,
        setupLinkResent: Boolean(existingAccount.setupPending)
      });
    }
    const superagentId = String(req.body?.superagentId || '');
    if (superagentId && !mongoose.isValidObjectId(superagentId)) return res.status(400).json({ error: 'Choose a valid active Superagent.' });
    const openingFloat = Number(req.body?.openingFloat ?? 0);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) return res.status(400).json({ error: 'Opening float must be a non-negative amount.' });
    ensureInvitationConfigured();
    const invite = createInvitationToken();
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    let agent;
    let account;
    let transaction;
    try {
      const now = new Date();
      agent = await Agent.create({
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
      });
      account = await MobileAccount.create({
        role: 'agent', agent: agent._id, email, passwordHash,
        inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt, setupPending: true
      });
      if (openingFloat > 0) {
        transaction = await Transaction.create({
          agent: agent._id, amount: openingFloat, kind: 'float_top_up',
          ...(agent.location ? { location: agent.location } : {})
        });
      }
      if (superagentId) {
        const assignment = await MobileAccount.updateOne(
          { _id: superagentId, role: 'superagent', active: true },
          { $addToSet: { managedAgents: agent._id } }
        );
        if (assignment.matchedCount !== 1) {
          const error = new Error('The selected Superagent is no longer active. Refresh the form and try again.');
          error.status = 409;
          throw error;
        }
      }
    } catch (error) {
      const cleanupErrors = [];
      if (superagentId && agent) {
        try {
          await MobileAccount.updateOne({ _id: superagentId, role: 'superagent' }, { $pull: { managedAgents: agent._id } });
        } catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (transaction) {
        try { await Transaction.deleteOne({ _id: transaction._id }); }
        catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (account) {
        try { await MobileAccount.deleteOne({ _id: account._id }); }
        catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (agent) {
        try { await Agent.deleteOne({ _id: agent._id }); }
        catch (cleanupError) { cleanupErrors.push(cleanupError); }
      }
      if (cleanupErrors.length) console.error('Agent creation rollback was incomplete:', cleanupErrors);
      throw error;
    }
    try {
      await sendStaffInvitation({ email, name: agent.name, role: 'agent', token: invite.token });
    } catch (error) {
      console.error('Unable to deliver agent invitation:', error.message);
      return res.status(502).json({ error: `The agent and login were created, but the invitation email could not be sent. Resend the invitation from Settings. ${error.message}`, accountCreated: true, id: String(account._id) });
    }
    broadcast('agent:telemetry', agent);
    let warning;
    if (agent.floatBalance <= lowFloatThreshold(agent)) {
      try {
        await notifyLowFloat(agent);
      } catch (error) {
        console.error('Agent and login were created, but the low-float alert could not be recorded:', error);
        warning = 'The Agent and login were created, but the low-float alert could not be recorded. Review the alert queue.';
      }
    }
    res.status(201).json({
      profile: agent,
      account: { id: String(account._id), role: account.role, email: account.email, active: account.active },
      ...(warning ? { warning } : {})
    });
  } catch (error) { apiError(res, error); }
});

app.post('/api/admin/distributors', requireAdmin, async (req, res) => {
  try {
    const { email } = mobileCredentialsInput(req.body);
    const updates = adminProfileInput(req.body, 'distributor');
    ensureInvitationConfigured();
    const invite = createInvitationToken();
    const passwordHash = hashPassword(crypto.randomBytes(32).toString('hex'));
    let distributor;
    let account;
    try {
      distributor = await Distributor.create({
        ...updates,
        distributor_id: crypto.randomUUID(),
        ...(updates.location ? { live_location: updates.location } : {}),
        status: 'offline',
        duty_state: 'inactive',
        lastSeenAt: new Date()
      });
      account = await MobileAccount.create({
        role: 'distributor', distributor: distributor._id, email, passwordHash,
        inviteTokenHash: invite.tokenHash, inviteExpiresAt: invite.expiresAt, setupPending: true
      });
    } catch (error) {
      if (account) {
        try { await MobileAccount.deleteOne({ _id: account._id }); }
        catch (cleanupError) { console.error('Distributor creation rollback could not remove the account:', cleanupError); }
      }
      if (distributor) {
        try { await Distributor.deleteOne({ _id: distributor._id }); }
        catch (cleanupError) { console.error('Distributor creation rollback could not remove the profile:', cleanupError); }
      }
      throw error;
    }
    try {
      await sendStaffInvitation({ email, name: distributor.name, role: 'distributor', token: invite.token });
    } catch (error) {
      console.error('Unable to deliver distributor invitation:', error.message);
      return res.status(502).json({ error: `The distributor and login were created, but the invitation email could not be sent. Resend the invitation from Settings. ${error.message}`, accountCreated: true, id: String(account._id) });
    }
    broadcast('distributor:location', distributor);
    res.status(201).json({
      profile: distributor,
      account: { id: String(account._id), role: account.role, email: account.email, active: account.active }
    });
  } catch (error) { apiError(res, error); }
});

app.patch('/api/admin/:role(agents|distributors)/:id', requireAdmin, async (req, res) => {
  const role = req.params.role === 'agents' ? 'agent' : 'distributor';
  try {
    if (req.body?.password !== undefined) return res.status(400).json({ error: 'Use the password reset action to email a secure reset link.' });
    const updates = adminProfileInput(req.body, role);
    const { email } = mobileCredentialsInput(req.body);
    const Model = role === 'agent' ? Agent : Distributor;
    const invite = createInvitationToken();
    const session = await mongoose.startSession();
    let profile;
    let account;
    let sendInvitation = false;
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
          account.sessionVersion += 1;
          await account.save({ session });
        } else {
          ensureInvitationConfigured();
          [account] = await MobileAccount.create([{
            role,
            [role]: profile._id,
            email,
            passwordHash: hashPassword(crypto.randomBytes(32).toString('hex')),
            inviteTokenHash: invite.tokenHash,
            inviteExpiresAt: invite.expiresAt,
            setupPending: true
          }], { session });
          sendInvitation = true;
        }
      });
    } finally { await session.endSession(); }
    if (sendInvitation) {
      try {
        await sendStaffInvitation({ email, name: profile.name, role, token: invite.token });
      } catch (error) {
        console.error(`Unable to deliver ${role} invitation:`, error.message);
        return res.status(502).json({ error: `The mobile account was created, but its invitation email could not be sent. Resend the invitation from Settings. ${error.message}`, accountCreated: true, id: String(account._id) });
      }
    }
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
    const archivedAt = new Date();
    profile.archivedAt = archivedAt;
    if (role === 'agent') {
      finishAgentShift(profile, archivedAt);
      profile.status = 'offline';
    } else {
      if (profile.status !== 'offline') finishDistributorShift(profile, archivedAt);
      profile.status = 'offline';
    }
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

};
