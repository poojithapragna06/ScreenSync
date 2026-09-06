const mongoose = require('mongoose');
const { PRIORITY } = require('../utils/constants');

const alertSchema = new mongoose.Schema(
  {
    alert_id: {
      type: String,
      required: true,
      unique: true,
      default: () => `alert_${new mongoose.Types.ObjectId().toString()}`,
    },
    message: {
      type: String,
      required: [true, 'Alert message is required'],
      trim: true,
      maxlength: 1000,
    },
    priority: {
      type: Number,
      default: PRIORITY.EMERGENCY,
      enum: Object.values(PRIORITY),
    },
    expires: {
      type: Date,
      required: [true, 'Expiration time is required'],
    },
    active: {
      type: Boolean,
      default: true,
    },
    pushedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

alertSchema.index({ active: 1, expires: 1 });

alertSchema.methods.isExpired = function isExpired(now = new Date()) {
  return this.expires <= now;
};

module.exports = mongoose.model('Alert', alertSchema);
