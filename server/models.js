const mongoose = require('mongoose');

const point = {
  type: { type: String, enum: ['Point'], default: 'Point', required: true },
  coordinates: { type: [Number], required: true } // [longitude, latitude]
};
const optionalPoint = {
  type: new mongoose.Schema(point, { _id: false }),
  default: undefined
};
function lowFloatThreshold(agent = {}) {
  const safeThreshold = Number(agent.safeThreshold) || 40;
  const floatReference = Math.max(0, Number(agent.floatReference) || 0);
  return Math.max(safeThreshold, 10000, floatReference * 0.1);
}

const agentSchema = new mongoose.Schema({
  agent_id: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  passwordHash: { type: String, select: false },
  location: optionalPoint,
  place: { type: String, default: '' },
  zone: { type: String, default: '' },
  agentType: { type: String, enum: ['mobile','fixed'], default: 'mobile' },
  agent_type: { type: String, enum: ['mobile','fixed'], default: 'mobile' },
  floatBalance: { type: Number, min: 0, default: 0 },
  floatReference: { type: Number, min: 0, default: null },
  current_float: { type: Number, min: 0, default: 0 },
  liquidityStatus: { type: String, enum: ['high', 'low', 'empty'], default: 'high' },
  safeThreshold: { type: Number, min: 0, default: 40 },
  status: { type: String, enum: ['active', 'offline', 'at_risk'], default: 'active' },
  archivedAt: { type: Date, default: null },
  shiftStartedAt: { type: Date, default: null },
  lastShiftSeconds: { type: Number, min: 0, default: 0 },
  shiftSeconds: { type: Number, min: 0, default: 0 },
  lastSeenAt: { type: Date, default: Date.now },
  last_updated: { type: Date, default: Date.now },
  deviceId: { type: String, index: true, sparse: true }
}, { timestamps: true });
agentSchema.pre('validate', function syncFloat(next) {
  if (this.isModified('floatBalance')) this.current_float = this.floatBalance;
  else if (this.isModified('current_float')) this.floatBalance = this.current_float;
  this.liquidityStatus = this.floatBalance <= 0 ? 'empty' : this.floatBalance <= lowFloatThreshold(this) ? 'low' : 'high';
  this.last_updated = this.lastSeenAt || new Date();
  next();
});
agentSchema.index({ location: '2dsphere' });
agentSchema.index({ status: 1, floatBalance: 1 });

const distributorSchema = new mongoose.Schema({
  distributor_id: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  full_name: { type: String, default: '' },
  phone: { type: String, default: '', trim: true, maxlength: 32 },
  passwordHash: { type: String, select: false },
  place: { type: String, default: '', trim: true, maxlength: 100 },
  zone: { type: String, default: '', trim: true, maxlength: 80 },
  location: optionalPoint,
  live_location: optionalPoint,
  status: { type: String, enum: ['available', 'busy', 'offline'], default: 'offline' },
  archivedAt: { type: Date, default: null },
  duty_state: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
  dutyStartedAt: { type: Date, default: null },
  assigned_tasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch' }],
  lastSeenAt: { type: Date, default: Date.now }
}, { timestamps: true });
distributorSchema.pre('validate', function syncLocation(next) {
  if (this.isModified('location')) this.live_location = this.location;
  else if (this.isModified('live_location')) this.location = this.live_location;
  this.full_name = this.full_name || this.name;
  this.duty_state = this.status === 'offline' ? 'inactive' : 'active';
  next();
});
distributorSchema.index({ location: '2dsphere' });
distributorSchema.index({ status: 1 });

const alertSchema = new mongoose.Schema({
  alert_id: { type: String, unique: true, sparse: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  agent_ref_id: { type: String, default: '' },
  kind: { type: String, enum: ['low_float_sos'], default: 'low_float_sos' },
  severity: { type: String, enum: ['warning', 'critical'], default: 'critical' },
  balanceAtTrigger: { type: Number, required: true },
  message: { type: String, default: '', maxlength: 500 },
  location: optionalPoint,
  state: { type: String, enum: ['open', 'dispatched', 'resolved'], default: 'open' },
  resolved_status: { type: Boolean, default: false },
  assigned_distributor_id: { type: String, default: '' },
  triggeredAt: { type: Date, default: Date.now },
  timestamp: { type: Date, default: Date.now },
  resolvedAt: Date
}, { timestamps: true });
alertSchema.pre('validate', function syncAlert(next) {
  this.agent_ref_id = this.agent_ref_id || String(this.agent);
  this.resolved_status = this.state === 'resolved';
  next();
});
alertSchema.index({ location: '2dsphere' });
alertSchema.index({ state: 1, triggeredAt: -1 });

const dispatchMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['admin', 'distributor'], required: true },
  senderName: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now }
}, { _id: false });

const dispatchSchema = new mongoose.Schema({
  alert: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', required: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  distributor: { type: mongoose.Schema.Types.ObjectId, ref: 'Distributor', required: true },
  instructions: { type: String, default: '', trim: true, maxlength: 500 },
  messages: { type: [dispatchMessageSchema], default: [] },
  status: { type: String, enum: ['assigned', 'en_route', 'completed', 'cancelled'], default: 'assigned' },
  distanceMeters: { type: Number, required: true },
  routeCoordinates: { type: [[Number]], default: [] },
  routeDistanceMeters: { type: Number, default: 0 },
  routeDurationSeconds: { type: Number, default: null },
  routeSource: { type: String, enum: ['road','geodesic'], default: 'geodesic' },
  assignedAt: { type: Date, default: Date.now },
  amountAdded: { type: Number, min: 0, default: null },
  floatBalanceAfter: { type: Number, min: 0, default: null },
  completedAt: Date
}, { timestamps: true });
dispatchSchema.index({ status: 1, assignedAt: -1 });

const transactionSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  amount: { type: Number, required: true },
  kind: { type: String, enum: ['ticket_sale', 'float_top_up'], required: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: 'FloatSettlement' },
  location: optionalPoint,
  occurredAt: { type: Date, default: Date.now }
}, { timestamps: true });
transactionSchema.index({ occurredAt: -1 });
transactionSchema.index({ kind: 1, occurredAt: -1, agent: 1 });

const floatSettlementSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  usedFloat: { type: Number, min: 0, required: true },
  depositAmount: { type: Number, min: 0, required: true },
  bankReference: { type: String, required: true, trim: true, maxlength: 100 },
  notes: { type: String, default: '', trim: true, maxlength: 500 },
  proofData: { type: Buffer, required: function requireProofOnInsert() { return this.isNew; }, select: false },
  proofMimeType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: String, default: '' },
  reviewedAt: Date,
  reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
  approvedFloat: { type: Number, min: 0, default: 0 },
  creditedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }
}, { timestamps: true });
floatSettlementSchema.index({ status: 1, createdAt: -1 });
floatSettlementSchema.index({ agent: 1 }, { unique: true, name: 'one_pending_settlement_per_agent', partialFilterExpression: { status: 'pending' } });

const commuterLogSchema = new mongoose.Schema({
  session_id: { type: String, required: true, index: true },
  geo_search_center: point,
  viewed_agents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });
commuterLogSchema.index({ geo_search_center: '2dsphere' });

const operationalEventSchema = new mongoose.Schema({
  event_id: { type: String, unique: true, sparse: true },
  action_type: { type: String, enum: ['replenish', 'alert_trigger', 'dispatch_assigned', 'dispatch_completed', 'dispatch_cancelled', 'commuter_search', 'float_settlement_submitted', 'float_settlement_approved', 'float_settlement_rejected'], required: true },
  actor_id: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });
operationalEventSchema.index({ action_type: 1, timestamp: -1 });

const adminProfileSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'primary' },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  sessionVersion: { type: Number, default: 0 }
}, { timestamps: true });

const mobileAccountSchema = new mongoose.Schema({
  role: { type: String, enum: ['agent', 'distributor', 'superagent'], required: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent' },
  distributor: { type: mongoose.Schema.Types.ObjectId, ref: 'Distributor' },
  name: { type: String, trim: true, maxlength: 80 },
  managedAgents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Agent' }],
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  sessionVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
mobileAccountSchema.index({ agent: 1 }, { unique: true, sparse: true });
mobileAccountSchema.index({ distributor: 1 }, { unique: true, sparse: true });
mobileAccountSchema.pre('validate', function validateRoleAccount(next) {
  if ((this.role === 'agent' && (!this.agent || this.distributor)) ||
      (this.role === 'distributor' && (!this.distributor || this.agent)) ||
      (this.role === 'superagent' && (!this.name || this.agent || this.distributor))) {
    this.invalidate('role', 'Provide exactly one matching agent or distributor record.');
  }
  next();
});

const superagentDeletionRequestSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  superagent: { type: mongoose.Schema.Types.ObjectId, ref: 'MobileAccount', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewNote: { type: String, default: '', trim: true, maxlength: 500 },
  reviewedAt: Date
}, { timestamps: true });
superagentDeletionRequestSchema.index(
  { agent: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);
superagentDeletionRequestSchema.index({ superagent: 1, createdAt: -1 });

const commuterAccountSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  sessionVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

const distributorInboxMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['admin', 'distributor'], required: true },
  senderName: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now }
}, { _id: false });
const distributorInboxSchema = new mongoose.Schema({
  distributor: { type: mongoose.Schema.Types.ObjectId, ref: 'Distributor', required: true, unique: true },
  messages: { type: [distributorInboxMessageSchema], default: [] }
}, { timestamps: true });

module.exports = {
  lowFloatThreshold,
  Agent: mongoose.model('Agent', agentSchema),
  Distributor: mongoose.model('Distributor', distributorSchema),
  Alert: mongoose.model('Alert', alertSchema, 'liquidity_alerts'),
  Dispatch: mongoose.model('Dispatch', dispatchSchema),
  Transaction: mongoose.model('Transaction', transactionSchema),
  FloatSettlement: mongoose.model('FloatSettlement', floatSettlementSchema),
  CommuterLog: mongoose.model('CommuterLog', commuterLogSchema, 'commuter_logs'),
  OperationalEvent: mongoose.model('OperationalEvent', operationalEventSchema, 'operational_events'),
  AdminProfile: mongoose.model('AdminProfile', adminProfileSchema, 'admin_profiles'),
  MobileAccount: mongoose.model('MobileAccount', mobileAccountSchema, 'mobile_accounts'),
  SuperagentDeletionRequest: mongoose.model('SuperagentDeletionRequest', superagentDeletionRequestSchema, 'superagent_deletion_requests'),
  CommuterAccount: mongoose.model('CommuterAccount', commuterAccountSchema, 'commuter_accounts'),
  DistributorInbox: mongoose.model('DistributorInbox', distributorInboxSchema, 'distributor_inboxes')
};
