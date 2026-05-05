/**
 * AEC Smart Result Access System — Express Server Entry Point
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimit');
const apiRouter = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiter on all API routes
app.use('/api', generalLimiter);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── SPA Fallback ──────────────────────────────────────────────────────────────
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error. Please try again.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🎓 AEC Smart Result Access System`);
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📦 Cache TTL: ${(process.env.CACHE_TTL_MS || 3600000) / 60000} minutes`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[server] Received ${signal}. Closing server...`);
  server.close(() => {
    console.log('[server] HTTP server closed. Exiting.');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
