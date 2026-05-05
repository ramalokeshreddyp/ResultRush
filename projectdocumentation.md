# Project Documentation — AEC Smart Result Access System

This document provides complete module-level documentation, usage examples, testing strategy, and verification steps.

---

## Main Idea & Objective

Provide students with fast access to their semester results by acting as a caching proxy to the AEC exam portal. The project minimizes repeated load on the official portal while offering a friendly frontend and simple administrative endpoints for cache management and prefetching.

---

## Modules & Responsibilities

- `server/index.js`
  - Bootstraps the Express app, loads environment variables, mounts middleware and routes, serves static `public/` folder, and starts the HTTP server.

- `server/routes/api.js`
  - Primary API routing file. Important endpoints:
    - `GET /api/result/:htno` — main entry point; validates HTNo; returns either cached data or fresh data from `scrapeResult`; enforces cooldowns and performs background refresh.
    - `GET /api/stats` — returns cache stats from `cache.stats()`.
    - `DELETE /api/cache/:htno` — evict a cached entry.
    - `POST /api/prefetch` — queue bulk prefetches (fire-and-forget in background).
    - `GET /api/cache/list` — admin listing of cached entries.

- `server/services/cache.js`
  - In-memory Map-backed cache that stores `{ data, fetchedAt, ttl }` per HTNo key. Implements LRU by moving accessed entries to the Map end. Tracks `hits` and `misses` for stats.
  - Functions: `get(htno)`, `set(htno, data, ttlMs)`, `evict(htno)`, `clear()`, `stats()`, `list()`.

- `server/services/scraper.js`
  - Encapsulates the portal scraping flow using a new cookie jar per scrape.
  - Steps:
    1. GET `/Login.aspx` to obtain ASP.NET hidden fields
    2. POST `__EVENTTARGET=lnkStudent` to reveal the student login form
    3. POST credentials (HTNo used as username/password)
    4. GET `OverallMarksSemwise.aspx` and parse latest published semester
  - Returns structured JSON: `{ studentInfo, cgpa, totalCredits, backlogs, latestSemLabel, courses, fetchedAt }`.

- `server/middleware/rateLimit.js`
  - Uses `express-rate-limit` to implement a global per-IP limiter (default: 20 requests/minute) and exposes `PORTAL_FETCH_COOLDOWN_MS` used by the API to throttle fresh portal fetches per HTNo.

- `public/` (frontend)
  - `index.html` — responsive single-page UI
  - `app.js` — UI logic to fetch `/api/result/:htno`, show loader, render data, and poll `/api/stats`.
  - `style.css` — polished, responsive styling. Works from mobile → desktop.

---

## Data Model (API payload)

Example payload returned by `GET /api/result/:htno`:

```json
{
  "success": true,
  "source": "cache|portal",
  "fetchedAt": "2026-05-05T...",
  "data": {
    "studentInfo": { "htno": "23A91A05I2", "name": "...", "branch": "CSE", "currentSem": "V SEMESTER" },
    "cgpa": "8.23",
    "totalCredits": "120",
    "backlogs": "0",
    "latestSemLabel": "V SEMESTER",
    "courses": [ { "siNo": "1", "courseCode":"501CS", "courseName":"...", "grade":"A", "credits":"3", "status":"PASS" } ]
  }
}
```

---

## Error Handling & Status Codes

- `400` — invalid input (malformed HTNo or missing body)
- `401` — login failure / invalid Hall Ticket Number
- `429` — portal fetch cooldown or global rate limit exceeded
- `503` — portal unreachable
- `500` — unexpected internal error

Error responses include a human-friendly `error` message and often a `suggestion` field.

---

## Integration Details

- Cookie isolation: each scrape uses a fresh `CookieJar` so no session sharing occurs.
- `axios` requests include `User-Agent` and `Referer` headers and a short timeout (20s) to avoid long-hanging requests.
- The scraper extracts ASP.NET hidden fields (`__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`) and performs form posts to emulate portal interactions.

---

## Testing Strategy

1. Unit (manual) checks:
   - `GET /api/stats` returns valid JSON and stats keys.
   - `GET /api/result/:htno` with invalid HTNo returns `400`.
2. Smoke test:
   - Start server: `npm start`.
   - `curl http://localhost:3000/api/stats` — expect `success: true`.
   - `curl http://localhost:3000/api/result/23A91A05I2` — expect either `success:true` with data or a portal-related error.
3. Integration:
   - Test `POST /api/prefetch` with an array of HTNos (<= 20) and confirm cached entries appear in `/api/cache/list`.
4. Edge cases:
   - Portal UI change: scraper may throw 'Could not load student login form' or parsing may return empty courses; treat such cases as indicators for maintenance.

---

## Verification Steps (End-to-end)

1. `npm install` → `npm start`
2. Open `http://localhost:3000` and use the frontend UI with an HTNo.
3. Verify `/api/stats` reflects hits/misses after requests.
4. Force refresh and watch the API return `source: "portal"`.

---

## Maintenance Notes

- If the portal changes layout, update parsing logic in `server/services/scraper.js` (selectors, form field names, or patterns).
- For frequent usage, move to Redis and add instrumentation (Prometheus metrics) for cache hit rate, portal errors, and request latencies.

---

## Appendix — Helpful Links & Commands

Start server:

```powershell
npm install
npm start
```

Check API:

```powershell
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/result/23A91A05I2
```
