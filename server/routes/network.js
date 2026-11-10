module.exports = (context) => {
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = context;
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

app.get('/api/admin/commuter-map/stats', async (_req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const activeSince = new Date(Date.now() - 15 * 60 * 1000);
    const activeQuery = { archivedAt: null, status: { $in: ['active', 'at_risk'] }, lastSeenAt: { $gte: activeSince } };
    const [mapAccesses, commuterSessions, activeAgentCount, agents] = await Promise.all([
      CommuterLog.countDocuments({ timestamp: { $gte: since } }),
      CommuterLog.distinct('session_id', { timestamp: { $gte: since } }),
      Agent.countDocuments(activeQuery),
      Agent.find(activeQuery).select('name agent_id phone place zone location status lastSeenAt floatBalance floatReference safeThreshold').sort({ name: 1 }).limit(1000).lean()
    ]);
    const locatedAgents = agents.filter(agent => validPoint(agent.location));
    const accounts = await MobileAccount.find({ role: 'agent', agent: { $in: locatedAgents.map(agent => agent._id) } }).select('agent email active').lean();
    const accountByAgent = new Map(accounts.map(account => [String(account.agent), account]));
    res.json({
      periodDays: 30,
      mapAccesses,
      commuterSessions: commuterSessions.length,
      activeAgents: activeAgentCount,
      locatedAgents: locatedAgents.length,
      generatedAt: new Date(),
      agents: locatedAgents.map(agent => {
        const account = accountByAgent.get(String(agent._id));
        return { ...agent, mobileEmail: account?.email || '', mobileLoginActive: Boolean(account?.active) };
      })
    });
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

  return { triggerSos, notifyLowFloat };
};
