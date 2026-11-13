const mongoose = require('mongoose');
const { optionalPoint } = require('./geo');

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
  supportRequestedAt: { type: Date, default: null },
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
  salesCollected: { type: Number, min: 0, default: 0 },
  amountAdded: { type: Number, min: 0, default: null },
  floatBalanceAfter: { type: Number, min: 0, default: null },
  completedAt: Date
}, { timestamps: true });
dispatchSchema.index({ status: 1, assignedAt: -1 });

module.exports = {
  Distributor: mongoose.model('Distributor', distributorSchema),
  Alert: mongoose.model('Alert', alertSchema, 'liquidity_alerts'),
  Dispatch: mongoose.model('Dispatch', dispatchSchema)
};
