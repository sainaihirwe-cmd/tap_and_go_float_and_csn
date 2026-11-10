const mongoose = require('mongoose');

function validPoint(location) {
  return location?.type === 'Point' && Array.isArray(location.coordinates) &&
    location.coordinates.length === 2 && location.coordinates.every(Number.isFinite) &&
    location.coordinates[0] >= -180 && location.coordinates[0] <= 180 &&
    location.coordinates[1] >= -90 && location.coordinates[1] <= 90;
}

function mobileProfileUpdates(body = {}) {
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
      const error = new Error('Name must be between 1 and 80 characters.');
      error.status = 400;
      throw error;
    }
    updates.name = body.name.trim();
  }
  for (const field of ['phone', 'place']) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const maximum = field === 'phone' ? 32 : 100;
    if (typeof body[field] !== 'string' || body[field].trim().length > maximum) {
      const error = new Error(`${field} must be no more than ${maximum} characters.`);
      error.status = 400;
      throw error;
    }
    updates[field] = body[field].trim();
  }
  if (!Object.keys(updates).length) {
    const error = new Error('Provide at least one profile field to update.');
    error.status = 400;
    throw error;
  }
  return updates;
}

function publicIdQuery(id, publicField) {
  return mongoose.isValidObjectId(id) ? { _id: id } : { [publicField]: id };
}

module.exports = { validPoint, mobileProfileUpdates, publicIdQuery };
