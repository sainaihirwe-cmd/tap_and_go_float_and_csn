module.exports = (context) => {
  const { app, io, mongoose, crypto, axios, getRoute, Agent, Distributor, Alert, Dispatch, Transaction, FloatSettlement, CommuterLog, OperationalEvent, AdminProfile, MobileAccount, CommuterAccount, DistributorInbox, SuperagentInbox, SuperagentDeletionRequest, lowFloatThreshold, adminEmail, adminPassword, authSecret, allowedOrigins, sosThreshold, distributorLocationMaxAgeMs, dispatchSearchRadiusMeters, bankSlipUpload, validPoint, mobileProfileUpdates, publicIdQuery, broadcast, notifyAssignedDistributor, issueAdminSession, issueMobileSession, verifySignedToken, requireMobile, mobileEntityQuery, sessionFromToken, sessionFromRequest, requireAdmin, hashPassword, passwordMatchesHash, mobileAccountView, backfillProfilePasswordHashes, passwordMatchesConfig, setAdminCookie, apiError } = context;
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

};
