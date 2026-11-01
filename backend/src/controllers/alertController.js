const Alert = require('../models/Alert');
const asyncHandler = require('../utils/asyncHandler');
const { broadcastToTVs } = require('../services/websocketService');
const { CONTENT_TYPE, PRIORITY } = require('../utils/constants');

// POST /pushAlert
const pushAlert = asyncHandler(async (req, res) => {
  const { message, priority, expires } = req.body;

  if (!message || !expires) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: ['message and expires are required'],
    });
  }

  const alert = await Alert.create({
    message,
    priority: priority || PRIORITY.EMERGENCY,
    expires,
    active: true,
    pushedBy: req.user.id,
  });

  broadcastToTVs({
    type: CONTENT_TYPE.ALERT,
    alert_id: alert.alert_id,
    message: alert.message,
    priority: alert.priority,
    expires: alert.expires,
  });

  return res.status(201).json({
    success: true,
    message: 'Alert pushed successfully',
    data: { alert },
  });
});

// GET /getAlerts - currently active (non-expired) alerts
const getAlerts = asyncHandler(async (req, res) => {
  const now = new Date();
  const alerts = await Alert.find({ active: true, expires: { $gt: now } }).sort({ priority: -1, createdAt: -1 });
  return res.status(200).json({ success: true, message: 'Active alerts retrieved successfully', data: { alerts } });
});

// GET /getAllAlerts - full alert history for admin UI
const getAllAlerts = asyncHandler(async (req, res) => {
  const alerts = await Alert.find().sort({ createdAt: -1 });
  return res.status(200).json({ success: true, message: 'Alerts retrieved successfully', data: { alerts } });
});

// POST /clearAlert/:alertId - deactivates an alert early and notifies TVs
const clearAlert = asyncHandler(async (req, res) => {
  const { alertId } = req.params;
  const alert = await Alert.findById(alertId);
  if (!alert) {
    return res.status(404).json({ success: false, message: 'Alert not found', errors: [] });
  }

  alert.active = false;
  await alert.save();

  broadcastToTVs({ type: 'clear_alert', alert_id: alert.alert_id });

  return res.status(200).json({ success: true, message: 'Alert cleared successfully', data: { alert } });
});

// DELETE /deleteAlert/:alertId - remove one alert from history (also takes it off the screens if active)
const deleteAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findByIdAndDelete(req.params.alertId);
  if (!alert) {
    return res.status(404).json({ success: false, message: 'Alert not found', errors: [] });
  }
  if (alert.active && alert.expires > new Date()) {
    broadcastToTVs({ type: 'clear_alert', alert_id: alert.alert_id });
  }
  return res.status(200).json({ success: true, message: 'Alert deleted', data: {} });
});

// DELETE /clearAlertHistory - delete every cleared or expired alert (active ones are kept)
const clearAlertHistory = asyncHandler(async (req, res) => {
  const result = await Alert.deleteMany({
    $or: [{ active: false }, { expires: { $lte: new Date() } }],
  });
  return res.status(200).json({
    success: true,
    message: `Deleted ${result.deletedCount} alert(s) from history`,
    data: { deleted: result.deletedCount },
  });
});

module.exports = { pushAlert, getAlerts, getAllAlerts, clearAlert, deleteAlert, clearAlertHistory };
