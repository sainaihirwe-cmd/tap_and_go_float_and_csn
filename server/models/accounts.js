const mongoose = require('mongoose');

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
  inviteTokenHash: { type: String, select: false },
  inviteExpiresAt: { type: Date },
  setupPending: { type: Boolean, default: false },
  sessionVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });
mobileAccountSchema.index({ agent: 1 }, { unique: true, sparse: true });
mobileAccountSchema.index({ distributor: 1 }, { unique: true, sparse: true });
mobileAccountSchema.index({ inviteTokenHash: 1 }, { unique: true, sparse: true });
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
  role: { type: String, enum: ['commuter'], default: 'commuter', immutable: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  sessionVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = {
  AdminProfile: mongoose.model('AdminProfile', adminProfileSchema, 'admin_profiles'),
  MobileAccount: mongoose.model('MobileAccount', mobileAccountSchema, 'mobile_accounts'),
  SuperagentDeletionRequest: mongoose.model('SuperagentDeletionRequest', superagentDeletionRequestSchema, 'superagent_deletion_requests'),
  CommuterAccount: mongoose.model('CommuterAccount', commuterAccountSchema, 'commuter_accounts')
};
