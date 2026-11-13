const mongoose = require('mongoose');

const point = {
  type: { type: String, enum: ['Point'], default: 'Point', required: true },
  coordinates: { type: [Number], required: true }
};

const optionalPoint = {
  type: new mongoose.Schema(point, { _id: false }),
  default: undefined
};

module.exports = { point, optionalPoint };
