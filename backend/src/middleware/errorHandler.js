// Central Express error handler. Normalizes Mongoose and generic errors
// into the project's standard API response shape.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  console.error('[Error]', err.message);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(409).json({
      success: false,
      message: `${field} already exists`,
      errors: [`Duplicate value for ${field}`],
    });
  }

  // Mongoose invalid ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid value for ${err.path}`,
      errors: [err.message],
    });
  }

  // Upload problems: tell the dashboard what's wrong instead of a server error
  if (err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({
      success: false,
      message: tooBig
        ? `File is too large (max ${Number(process.env.MAX_UPLOAD_MB) || 500} MB)`
        : `Upload failed: ${err.message}`,
      errors: [],
    });
  }
  if (err.message === 'Only image and video files are allowed') {
    return res.status(400).json({ success: false, message: err.message, errors: [] });
  }

  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    errors: err.errors || [],
  });
}

function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    errors: [],
  });
}

module.exports = { errorHandler, notFound };
