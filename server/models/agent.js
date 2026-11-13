const mongoose = require('mongoose');
const { optionalPoint } = require('./geo');

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

module.exports = {
  Agent: mongoose.model('Agent', agentSchema),
  lowFloatThreshold
};
