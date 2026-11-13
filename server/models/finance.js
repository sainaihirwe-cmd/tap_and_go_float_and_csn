const mongoose = require('mongoose');
const { optionalPoint } = require('./geo');

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
floatSettlementSchema.index(
  { agent: 1 },
  { unique: true, name: 'one_pending_settlement_per_agent', partialFilterExpression: { status: 'pending' } }
);

module.exports = {
  Transaction: mongoose.model('Transaction', transactionSchema),
  FloatSettlement: mongoose.model('FloatSettlement', floatSettlementSchema)
};
