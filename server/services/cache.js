/**
 * AEC Smart Result Access System — In-Memory Cache Service
 * TTL-based Map cache with LRU eviction and stats tracking.
 */

const DEFAULT_TTL_MS = parseInt(process.env.CACHE_TTL_MS) || 3600000; // 1 hour
const MAX_SIZE = parseInt(process.env.MAX_CACHE_SIZE) || 1000;

const store = new Map(); // htno -> { data, fetchedAt, ttl }
let hits = 0;
let misses = 0;

/**
 * Get cached result for a given HTNo.
 * Returns null if not found or expired.
 */
function get(htno) {
  const key = htno.toUpperCase();
  if (!store.has(key)) {
    misses++;
    return null;
  }

  const entry = store.get(key);
  const now = Date.now();

  if (now - entry.fetchedAt > entry.ttl) {
    // Expired — evict and return null
    store.delete(key);
    misses++;
    return null;
  }

  hits++;
  // Move to end (LRU: most recently used)
  store.delete(key);
  store.set(key, entry);
  return entry;
}

/**
 * Store a result in the cache with optional TTL override.
 */
function set(htno, data, ttlMs = DEFAULT_TTL_MS) {
  const key = htno.toUpperCase();

  // Evict oldest entry if at capacity
  if (store.size >= MAX_SIZE && !store.has(key)) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }

  store.set(key, {
    data,
    fetchedAt: Date.now(),
    ttl: ttlMs,
  });
}

/**
 * Manually evict a single entry by HTNo.
 */
function evict(htno) {
  const key = htno.toUpperCase();
  const existed = store.has(key);
  store.delete(key);
  return existed;
}

/**
 * Clear the entire cache.
 */
function clear() {
  store.clear();
  hits = 0;
  misses = 0;
}

/**
 * Return current stats.
 */
function stats() {
  const now = Date.now();
  let oldestMs = null;
  let expiredCount = 0;

  for (const [, entry] of store) {
    const age = now - entry.fetchedAt;
    if (age > entry.ttl) expiredCount++;
    if (oldestMs === null || age > oldestMs) oldestMs = age;
  }

  return {
    size: store.size,
    hits,
    misses,
    hitRate: hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : '0.0',
    oldestEntryAgeMs: oldestMs,
    expiredEntries: expiredCount,
    maxSize: MAX_SIZE,
    defaultTtlMs: DEFAULT_TTL_MS,
  };
}

/**
 * List all cached HTNos with metadata (for admin).
 */
function list() {
  const now = Date.now();
  return Array.from(store.entries()).map(([htno, entry]) => ({
    htno,
    fetchedAt: new Date(entry.fetchedAt).toISOString(),
    ageMs: now - entry.fetchedAt,
    ttlMs: entry.ttl,
    expired: now - entry.fetchedAt > entry.ttl,
  }));
}

module.exports = { get, set, evict, clear, stats, list };
