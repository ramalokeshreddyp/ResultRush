/**
 * AEC Smart Result Access System — Rate Limiting Middleware
 * Prevents abuse of the caching proxy.
 */

const rateLimit = require('express-rate-limit');

// General API rate limiter: 20 requests per minute per IP
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a moment and try again.',
    retryAfter: 60,
  },
  skip: (req) => {
    // Skip rate limiting for static files and stats
    return req.path === '/api/stats';
  },
});

// Per-HTNo portal fetch limiter: 1 fresh fetch per 5 minutes per HTNo
// This is enforced in the API route layer, not Express middleware,
// but we export the config here for consistency.
const PORTAL_FETCH_COOLDOWN_MS = parseInt(process.env.PORTAL_FETCH_COOLDOWN_MS) || 5 * 60 * 1000;

module.exports = { generalLimiter, PORTAL_FETCH_COOLDOWN_MS };
