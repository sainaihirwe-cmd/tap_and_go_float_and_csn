module.exports = (context) => {
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, AgentSuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = context;

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

app.get('/api/agents/:id/superagent-inbox', async (req, res) => {
  try {
    const agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id')).select('_id').lean();
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const superagent = await MobileAccount.findOne({
      role: 'superagent', active: true, managedAgents: agent._id
    }).select('_id name').lean();
    if (!superagent) return res.json({ assigned: false, superagent: null, messages: [], updatedAt: null });
    const inbox = await AgentSuperagentInbox.findOne({ agent: agent._id, superagent: superagent._id }).select('messages updatedAt').lean();
    res.json({
      assigned: true,
      superagent: { id: String(superagent._id), name: superagent.name },
      messages: inbox?.messages || [],
      updatedAt: inbox?.updatedAt || null
    });
  } catch (error) { apiError(res, error); }
});

app.post('/api/agents/:id/superagent-inbox', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    const agent = await Agent.findOne(mobileEntityQuery(req, req.params.id, 'agent_id')).select('_id name').lean();
    if (!agent) return res.status(404).json({ error: 'Agent not found.' });
    const superagent = await MobileAccount.findOne({
      role: 'superagent', active: true, managedAgents: agent._id
    }).select('_id').lean();
    if (!superagent) return res.status(409).json({ error: 'No active Superagent is assigned to this agent. Ask an administrator to assign one in Settings.' });
    const message = { sender: 'agent', senderName: agent.name, text, sentAt: new Date() };
    const inbox = await AgentSuperagentInbox.findOneAndUpdate(
      { agent: agent._id, superagent: superagent._id },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { superagentId: String(superagent._id), agentId: String(agent._id), message };
    io.to(`mobile:${superagent._id}`).emit('superagent:agent-message', event);
    const agentAccount = await MobileAccount.findOne({ role: 'agent', active: true, agent: agent._id }).select('_id').lean();
    if (agentAccount) io.to(`mobile:${agentAccount._id}`).emit('agent:superagent-message', event);
    res.status(201).json({ message, updatedAt: inbox.updatedAt });
  } catch (error) { apiError(res, error); }
});

app.get('/api/superagent/agent-inboxes', async (req, res) => {
  try {
    const agentIds = req.mobile.account.managedAgents || [];
    const [agents, inboxes] = await Promise.all([
      Agent.find({ _id: { $in: agentIds }, archivedAt: null }).select('name agent_id place zone').sort({ name: 1 }).lean(),
      AgentSuperagentInbox.find({ superagent: req.mobile.account._id, agent: { $in: agentIds } }).lean()
    ]);
    const inboxByAgent = new Map(inboxes.map(inbox => [String(inbox.agent), inbox]));
    res.json(agents.map(agent => {
      const inbox = inboxByAgent.get(String(agent._id));
      return {
        agent,
        messages: inbox?.messages || [],
        updatedAt: inbox?.updatedAt || null
      };
    }).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)));
  } catch (error) { apiError(res, error); }
});

app.get('/api/superagent/float-requests', async (req, res) => {
  try {
    const agentIds = req.mobile.account.managedAgents || [];
    const requests = await Alert.find({
      agent: { $in: agentIds },
      supportRequestedAt: { $ne: null }
    })
      .populate('agent', 'name agent_id place zone floatBalance')
      .sort({ supportRequestedAt: -1 })
      .limit(100)
      .lean();
    res.json(requests);
  } catch (error) { apiError(res, error); }
});

app.post('/api/superagent/agents/:agentId/inbox', async (req, res) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > 500) return res.status(400).json({ error: 'Message must be between 1 and 500 characters.' });
    const account = req.mobile.account;
    if (!mongoose.isValidObjectId(req.params.agentId) ||
        !account.managedAgents.some(id => String(id) === req.params.agentId)) {
      return res.status(404).json({ error: 'Agent not found in your assigned network.' });
    }
    const agent = await Agent.findOne({ _id: req.params.agentId, archivedAt: null }).select('name').lean();
    if (!agent) return res.status(404).json({ error: 'Agent not found in your assigned network.' });
    const message = { sender: 'superagent', senderName: account.name, text, sentAt: new Date() };
    const inbox = await AgentSuperagentInbox.findOneAndUpdate(
      { agent: req.params.agentId, superagent: account._id },
      { $push: { messages: { $each: [message], $slice: -200 } } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).select('messages updatedAt');
    const event = { superagentId: String(account._id), agentId: req.params.agentId, message };
    const agentAccount = await MobileAccount.findOne({ role: 'agent', active: true, agent: req.params.agentId }).select('_id').lean();
    if (agentAccount) io.to(`mobile:${agentAccount._id}`).emit('agent:superagent-message', event);
    io.to(`mobile:${account._id}`).emit('superagent:agent-message', event);
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

};
