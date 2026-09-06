const asyncHandler = require('../utils/asyncHandler');
const { getDevices } = require('../services/websocketService');

// GET /getDevices - snapshot of all registered TV devices and their live status
const listDevices = asyncHandler(async (req, res) => {
  const devices = getDevices();
  return res.status(200).json({
    success: true,
    message: 'Devices retrieved successfully',
    data: { devices },
  });
});

module.exports = { listDevices };
