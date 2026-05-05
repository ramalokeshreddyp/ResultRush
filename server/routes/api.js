/**
 * AEC Smart Result Access System — API Routes
 */

const express = require('express');
const router = express.Router();
const cache = require('../services/cache');
const { scrapeResult } = require('../services/scraper');
const { PORTAL_FETCH_COOLDOWN_MS } = require('../middleware/rateLimit');

// Health endpoint (status of cache and optional Redis)
router.get('/health', async (req, res) => {
  try {
    const stats = await (typeof cache.statsAsync === 'function' ? cache.statsAsync() : cache.stats());
    res.json({ success: true, healthy: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, healthy: false, error: err.message });
  }
});

// Track last portal fetch time per HTNo to enforce cooldown
const lastFetchTime = new Map();

// ── Validate HTNo format (basic check) ───────────────────────────────────────
function isValidHTNo(htno) {
  // AEC format examples: 23A91A05I2, 21A91A0501, 22A91A05B3
  // Pattern: 2 digits + A + 2 digits + A + 2 digits + alphanumeric
  return /^[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{2}[A-Z0-9]{1,3}$/i.test(htno.trim());
}

// ── GET /api/result/:htno ─────────────────────────────────────────────────────
router.get('/result/:htno', async (req, res) => {
  const { htno } = req.params;
  const forceRefresh = req.query.force === 'true';

  // Validate
  if (!htno || htno.trim().length < 8) {
    return res.status(400).json({
      error: 'Invalid Hall Ticket Number. Please enter a valid HTNo (e.g., 23A91A05I2).',
    });
  }

  const htnoKey = htno.toUpperCase().trim();

  // Some legacy cached entries may contain an enrolled semester label
  // with zero rows (e.g. VI SEMESTER before semwise results are published).
  // In that case, skip cache and fetch fresh so latest published semester
  // (e.g. V SEMESTER) is returned.
  let skipCacheForEmptyCourses = false;

  // ── Cache HIT path ──────────────────────────────────────────────────────────
  if (!forceRefresh) {
    const cached = cache.get(htnoKey);
    if (cached) {
      const cachedCourses = cached.data && Array.isArray(cached.data.courses) ? cached.data.courses : [];
      if (cachedCourses.length === 0) {
        skipCacheForEmptyCourses = true;
      }

      if (!skipCacheForEmptyCourses) {
      // Return cached result immediately to keep UI snappy,
      // but also trigger a background refresh to detect new semester
      // data and update the cache so subsequent requests see the
      // latest available semester automatically.
      (async () => {
        try {
          const lastFetch = lastFetchTime.get(htnoKey);
          if (!lastFetch || Date.now() - lastFetch >= PORTAL_FETCH_COOLDOWN_MS) {
            lastFetchTime.set(htnoKey, Date.now());
            try {
              const fresh = await scrapeResult(htnoKey);
              const oldLabel = (cached.data && cached.data.latestSemLabel) || (cached.data && cached.data.studentInfo && cached.data.studentInfo.currentSem) || '';
              const newLabel = (fresh && fresh.latestSemLabel) || (fresh && fresh.studentInfo && fresh.studentInfo.currentSem) || '';
              if (newLabel && newLabel.toUpperCase() !== oldLabel.toUpperCase()) {
                cache.set(htnoKey, fresh);
                console.log(`[bg-refresh] Updated cache for ${htnoKey}: ${oldLabel} -> ${newLabel}`);
              } else {
                // Update the fetchedAt to extend TTL without changing data
                cache.set(htnoKey, cached.data);
              }
            } catch (err) {
              // On failure, remove cooldown timestamp so future attempts can retry
              lastFetchTime.delete(htnoKey);
              console.warn(`[bg-refresh] Failed for ${htnoKey}: ${err.message}`);
            }
          }
        } catch (e) {
          console.warn('[bg-refresh] Unexpected error:', e && e.message);
        }
      })();

      return res.json({
        success: true,
        source: 'cache',
        cachedAt: new Date(cached.fetchedAt).toISOString(),
        ageMs: Date.now() - cached.fetchedAt,
        data: cached.data,
      });
      }
    }
  }

  // ── Portal fetch cooldown enforcement ──────────────────────────────────────
  const lastFetch = lastFetchTime.get(htnoKey);
  if (lastFetch && Date.now() - lastFetch < PORTAL_FETCH_COOLDOWN_MS && !forceRefresh && !skipCacheForEmptyCourses) {
    const waitSec = Math.ceil((PORTAL_FETCH_COOLDOWN_MS - (Date.now() - lastFetch)) / 1000);
    return res.status(429).json({
      error: `Portal fetch on cooldown. Please wait ${waitSec}s or the result is not yet cached.`,
      retryAfterSeconds: waitSec,
    });
  }

  // ── Cache MISS — scrape from portal ────────────────────────────────────────
  try {
    lastFetchTime.set(htnoKey, Date.now());
    const result = await scrapeResult(htnoKey);

    // Store in cache
    cache.set(htnoKey, result);

    return res.json({
      success: true,
      source: 'portal',
      fetchedAt: result.fetchedAt,
      ageMs: 0,
      data: result,
    });
  } catch (err) {
    // Remove cooldown timestamp on failure so user can retry
    lastFetchTime.delete(htnoKey);

    console.error(`[api] Scrape error for ${htnoKey}:`, err.message);

    const status = err.message.includes('Invalid Hall Ticket')
      ? 401
      : err.message.includes('Cannot reach')
      ? 503
      : 500;

    return res.status(status).json({
      error: err.message || 'Failed to fetch result from AEC portal.',
      suggestion:
        status === 503
          ? 'The AEC portal appears to be offline. Please try again later.'
          : status === 401
          ? 'Check your Hall Ticket Number and ensure it is correct.'
          : 'An unexpected error occurred. Please try again.',
    });
  }
});

// ── GET /api/stats ─────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  res.json({
    success: true,
    stats: cache.stats(),
    serverTime: new Date().toISOString(),
  });
});

// ── DELETE /api/cache/:htno ────────────────────────────────────────────────────
router.delete('/cache/:htno', (req, res) => {
  const { htno } = req.params;
  const existed = cache.evict(htno);
  lastFetchTime.delete(htno.toUpperCase());

  res.json({
    success: true,
    message: existed
      ? `Cache entry for ${htno.toUpperCase()} evicted.`
      : `No cache entry found for ${htno.toUpperCase()}.`,
  });
});

// ── POST /api/prefetch ─────────────────────────────────────────────────────────
// Bulk pre-fetch: accepts { htnos: ["23A91A05I2", "23A91A0512", ...] }
router.post('/prefetch', async (req, res) => {
  const { htnos } = req.body;

  if (!Array.isArray(htnos) || htnos.length === 0) {
    return res.status(400).json({ error: 'Provide an array of HTNos in body: { "htnos": [...] }' });
  }

  if (htnos.length > 20) {
    return res.status(400).json({ error: 'Max 20 HTNos per prefetch batch.' });
  }

  res.json({
    success: true,
    message: `Prefetch queued for ${htnos.length} HTNo(s). Results will be cached as they are fetched.`,
    queued: htnos.length,
  });

  // Fire and forget — run prefetches in background
  (async () => {
    for (const htno of htnos) {
      const key = htno.toUpperCase().trim();
      if (cache.get(key)) continue; // Already cached
      try {
        await new Promise((r) => setTimeout(r, 1000)); // Polite 1s delay
        const result = await scrapeResult(key);
        cache.set(key, result);
        console.log(`[prefetch] Cached ${key}`);
      } catch (err) {
        console.warn(`[prefetch] Failed ${key}: ${err.message}`);
      }
    }
  })();
});

// ── GET /api/cache/list ────────────────────────────────────────────────────────
router.get('/cache/list', (req, res) => {
  res.json({
    success: true,
    entries: cache.list(),
  });
});

module.exports = router;
