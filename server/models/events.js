const mongoose = require('mongoose');
const { point } = require('./geo');

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

module.exports = {
  CommuterLog: mongoose.model('CommuterLog', commuterLogSchema, 'commuter_logs'),
  OperationalEvent: mongoose.model('OperationalEvent', operationalEventSchema, 'operational_events')
};
