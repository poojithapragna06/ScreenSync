const Task = require('../models/Task');
const asyncHandler = require('../utils/asyncHandler');
const { broadcastToTVs } = require('../services/websocketService');
const { sortByPriorityDesc } = require('../services/priorityService');
const { CONTENT_TYPE } = require('../utils/constants');

// POST /createTask
const createTask = asyncHandler(async (req, res) => {
  const { title, content, priority, schedule } = req.body;

  if (!schedule || !schedule.start || !schedule.end) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['schedule.start and schedule.end are required'],
    });
  }

  const task = await Task.create({
    title,
    content,
    priority,
    schedule: { start: schedule.start, end: schedule.end },
    createdBy: req.user.id,
  });

  broadcastToTVs({
    type: CONTENT_TYPE.TASK,
    task_id: task.task_id,
    title: task.title,
    content: task.content,
    priority: task.priority,
    schedule: task.schedule,
  });

  return res.status(201).json({
    success: true,
    message: 'Task created successfully',
    data: { task },
  });
});

// GET /getTasks - returns active tasks sorted by priority (desc)
const getTasks = asyncHandler(async (req, res) => {
  const now = new Date();
  const tasks = await Task.find({
    'schedule.start': { $lte: now },
    'schedule.end': { $gte: now },
  });

  const sorted = sortByPriorityDesc(tasks.map((t) => t.toObject()));

  return res.status(200).json({
    success: true,
    message: 'Active tasks retrieved successfully',
    data: { tasks: sorted },
  });
});

// GET /getAllTasks - all tasks regardless of schedule window, for admin management UI
const getAllTasks = asyncHandler(async (req, res) => {
  const tasks = await Task.find().sort({ priority: -1, createdAt: -1 });
  return res.status(200).json({
    success: true,
    message: 'Tasks retrieved successfully',
    data: { tasks },
  });
});

// DELETE /deleteTask/:taskId
const deleteTask = asyncHandler(async (req, res) => {
  const { taskId } = req.params;
  const task = await Task.findByIdAndDelete(taskId);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found', errors: [] });
  }
  return res.status(200).json({ success: true, message: 'Task deleted successfully', data: {} });
});

module.exports = { createTask, getTasks, getAllTasks, deleteTask };
