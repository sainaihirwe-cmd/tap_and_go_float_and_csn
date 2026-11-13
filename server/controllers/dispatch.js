module.exports = (context) => {
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, triggerSos, notifyLowFloat, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = context;
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
    alert.supportRequestedAt = new Date();
    await alert.save();
    const superagent = await MobileAccount.findOne({
      role: 'superagent', active: true, managedAgents: agent._id
    }).select('_id').lean();
    if (superagent) {
      io.to(`mobile:${superagent._id}`).emit('superagent:float-support-request', {
        _id: String(alert._id),
        agent: {
          _id: String(agent._id),
          name: agent.name,
          place: agent.place,
          zone: agent.zone,
          floatBalance: agent.floatBalance
        },
        message: alert.message,
        state: alert.state,
        balanceAtTrigger: alert.balanceAtTrigger,
        supportRequestedAt: alert.supportRequestedAt
      });
    }
    const dispatch = await Dispatch.findOne({ alert: alert._id, status: { $in: ['assigned', 'en_route'] } })
      .populate('distributor', 'name phone location status').lean();
    res.status(202).json({
      alert: { id: String(alert._id), state: alert.state, message: alert.message, supportRequestedAt: alert.supportRequestedAt },
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
    const salesCollected = req.body.salesCollected === undefined ? 0 : req.body.salesCollected;
    if (req.body.status === 'completed' && (!Number.isFinite(salesCollected) || salesCollected < 0 || Math.round(salesCollected * 100) / 100 !== salesCollected)) {
      return res.status(400).json({ error: 'Enter collected ticket sales as a non-negative amount with no more than two decimal places.' });
    }
    let result;
    await session.withTransaction(async()=>{
      const dispatch=await Dispatch.findById(req.params.id).session(session);
      if(!dispatch){const error=new Error('Dispatch not found.');error.status=404;throw error}
      if(String(dispatch.distributor)!==String(req.mobile.account.distributor)){const error=new Error('This dispatch is assigned to another distributor.');error.status=403;throw error}
      if(!['assigned','en_route'].includes(dispatch.status)){const error=new Error('Dispatch is no longer active.');error.status=409;throw error}
      dispatch.status=req.body.status;if(req.body.status==='completed'){dispatch.completedAt=new Date();dispatch.salesCollected=salesCollected;dispatch.amountAdded=req.body.amountAdded}await dispatch.save({session});
      if(['completed','cancelled'].includes(req.body.status)){
        const distributor=await Distributor.findById(dispatch.distributor).session(session);
        if(distributor){distributor.status='available';distributor.duty_state='active';distributor.assigned_tasks.pull(dispatch._id);await distributor.save({session})}
        if(req.body.status==='completed'){
          const agent=await Agent.findById(dispatch.agent).session(session);
          if(!agent){const error=new Error('Agent for this dispatch no longer exists.');error.status=409;throw error}
          const previous=agent.floatBalance;
          if (salesCollected > previous) { const error=new Error('Collected ticket sales cannot exceed the agent POS float.');error.status=409;throw error; }
          if(!Number.isFinite(agent.floatReference)||agent.floatReference<=0)agent.floatReference=previous;
          agent.floatBalance=previous-salesCollected+req.body.amountAdded;agent.current_float=agent.floatBalance;agent.floatReference+=req.body.amountAdded;agent.status=agent.floatBalance<=lowFloatThreshold(agent)?'at_risk':'active';agent.lastSeenAt=new Date();agent.last_updated=agent.lastSeenAt;await agent.save({session});
          dispatch.floatBalanceAfter=agent.floatBalance;await dispatch.save({session});
          if (salesCollected > 0) await Transaction.create([{agent:agent._id,amount:salesCollected,kind:'ticket_sale',location:agent.location}],{session});
          await Transaction.create([{agent:agent._id,amount:req.body.amountAdded,kind:'float_top_up',location:agent.location}],{session});
          await Alert.findByIdAndUpdate(dispatch.alert,{$set:{state:'resolved',resolvedAt:new Date(),resolved_status:true}},{session});
          await OperationalEvent.create([{event_id:crypto.randomUUID(),action_type:'replenish',actor_id:String(dispatch.distributor),metadata:{dispatchId:String(dispatch._id),agentId:String(agent._id),amount_added:req.body.amountAdded,sales_collected:salesCollected,previous_float:previous}},{event_id:crypto.randomUUID(),action_type:'dispatch_completed',actor_id:String(dispatch.distributor),metadata:{dispatchId:String(dispatch._id)}}],{session});
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

  return { resolveAgentAlerts };
};
