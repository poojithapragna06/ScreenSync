const mongoose = require('mongoose');
const { PRIORITY } = require('../utils/constants');

const taskSchema = new mongoose.Schema(
  {
    task_id: {
      type: String,
      required: true,
      unique: true,
      default: () => `task_${new mongoose.Types.ObjectId().toString()}`,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: 200,
    },
    content: {
      type: String,
      required: [true, 'Content is required'],
      trim: true,
      maxlength: 2000,
    },
    priority: {
      type: Number,
      enum: Object.values(PRIORITY),
      default: PRIORITY.LOW,
    },
    schedule: {
      start: {
        type: Date,
        required: [true, 'Start time is required'],
      },
      end: {
        type: Date,
        required: [true, 'End time is required'],
        validate: {
          validator: function endAfterStart(value) {
            return !this.schedule || !this.schedule.start || value > this.schedule.start;
          },
          message: 'End time must be after start time',
        },
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

taskSchema.index({ priority: -1 });
taskSchema.index({ 'schedule.start': 1, 'schedule.end': 1 });

taskSchema.methods.isActiveNow = function isActiveNow(now = new Date()) {
  return this.schedule.start <= now && this.schedule.end >= now;
};

module.exports = mongoose.model('Task', taskSchema);
