const mongoose = require('mongoose');
const { PRIORITY, MEDIA_TYPE } = require('../utils/constants');

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
      // Optional when the task shows media instead of (or as well as) a message
      required: [
        function contentRequired() {
          return !(this.media && this.media.url);
        },
        'Content is required',
      ],
      trim: true,
      maxlength: 2000,
    },
    // Optional image / video / YouTube link shown full screen while the task is on
    media: {
      type: new mongoose.Schema(
        {
          media_type: {
            type: String,
            enum: [MEDIA_TYPE.IMAGE, MEDIA_TYPE.VIDEO, MEDIA_TYPE.YOUTUBE],
            required: true,
          },
          url: {
            type: String,
            required: [true, 'Media URL is required'],
            trim: true,
          },
          // Length of the video in seconds (YouTube only), so screens joining
          // late can work out where it should be
          duration: {
            type: Number,
            min: 0,
          },
        },
        { _id: false }
      ),
      default: undefined,
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
