// Shared helpers so every endpoint answers with the same error shape:
//   { "error": { "code": "<machine_code>", "message": "<human text>" } }
function sendError(res, status, code, message, details) {
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error });
}

const badRequest = (res, message, details) => sendError(res, 400, 'bad_request', message, details);
const unauthorized = (res, message) => sendError(res, 401, 'unauthorized', message || 'Login required.');
const forbidden = (res, message) => sendError(res, 403, 'forbidden', message || 'You do not have access to this resource.');
const notFound = (res, message) => sendError(res, 404, 'not_found', message || 'Not found.');
const conflict = (res, message) => sendError(res, 409, 'conflict', message);
const serverError = (res, err) => {
  console.error(err);
  return sendError(res, 500, 'server_error', 'Something went wrong.');
};

function requireLogin(req, res, next) {
  if (!req.user) return unauthorized(res);
  return next();
}

// Parse a positive integer route param; returns null if invalid.
function parseId(value) {
  return /^[1-9]\d*$/.test(String(value)) ? Number(value) : null;
}

module.exports = { sendError, badRequest, unauthorized, forbidden, notFound, conflict, serverError, requireLogin, parseId };
