const mongoose = require('mongoose');

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

const superagentInboxMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['admin', 'superagent'], required: true },
  senderName: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now }
}, { _id: false });
const superagentInboxSchema = new mongoose.Schema({
  superagent: { type: mongoose.Schema.Types.ObjectId, ref: 'MobileAccount', required: true, unique: true },
  messages: { type: [superagentInboxMessageSchema], default: [] }
}, { timestamps: true });

const agentSuperagentInboxMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['agent', 'superagent'], required: true },
  senderName: { type: String, required: true, trim: true, maxlength: 80 },
  text: { type: String, required: true, trim: true, maxlength: 500 },
  sentAt: { type: Date, default: Date.now }
}, { _id: false });
const agentSuperagentInboxSchema = new mongoose.Schema({
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'Agent', required: true },
  superagent: { type: mongoose.Schema.Types.ObjectId, ref: 'MobileAccount', required: true },
  messages: { type: [agentSuperagentInboxMessageSchema], default: [] }
}, { timestamps: true });
agentSuperagentInboxSchema.index({ agent: 1, superagent: 1 }, { unique: true });

module.exports = {
  DistributorInbox: mongoose.model('DistributorInbox', distributorInboxSchema, 'distributor_inboxes'),
  SuperagentInbox: mongoose.model('SuperagentInbox', superagentInboxSchema, 'superagent_inboxes'),
  AgentSuperagentInbox: mongoose.model('AgentSuperagentInbox', agentSuperagentInboxSchema, 'agent_superagent_inboxes')
};
