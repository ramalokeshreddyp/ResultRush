/**
 * AEC Smart Result Access System — Portal Scraper Service
 *
 * Login flow:
 *  1. GET /Login.aspx  → grabs ViewState (no login form yet)
 *  2. POST doPostBack('lnkStudent','') → reveals the login form
 *  3. POST credentials (HTNo = username = password)
 *  4. GET OverallMarksSemwise page → parse latest published semester
 *
 * Returns: cgpa, totalCredits, backlogs, latestSemLabel, courses[]
 */

const axios = require('axios').default;
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');
const cheerio = require('cheerio');

const BASE_URL  = 'https://examsection.aec.edu.in';
const LOGIN_URL = `${BASE_URL}/Login.aspx`;
const MARKS_URL = `${BASE_URL}/StudentLogin/Student/OverallMarksSemwise.aspx`;

const USER_AGENT =
  'AEC-Result-Cache-Bot/1.0 (Educational caching proxy; contact: aec-cache)';

/** Create a fresh axios client with its own cookie jar (session isolation). */
function createClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({
    jar,
    withCredentials: true,
    maxRedirects: 10,
    timeout: 20000,
    headers: {
      'User-Agent':      USER_AGENT,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Connection':      'keep-alive',
    },
  }));
}

/** Extract hidden ASP.NET form fields from a Cheerio-loaded page. */
function extractFormFields($) {
  return {
    __VIEWSTATE:          $('input[name="__VIEWSTATE"]').val()          || '',
    __VIEWSTATEGENERATOR: $('input[name="__VIEWSTATEGENERATOR"]').val() || '',
    __EVENTVALIDATION:    $('input[name="__EVENTVALIDATION"]').val()    || '',
    __EVENTTARGET:        '',
    __EVENTARGUMENT:      '',
  };
}

/** URL-encode a plain object into an application/x-www-form-urlencoded body. */
function encodeBody(obj) {
  return Object.entries(obj)
    .map(function(p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1] || ''); })
    .join('&');
}

/** Parse Roman semester from label like "VI SEMESTER". */
function romanToInt(roman) {
  if (!roman) return 0;
  const map = { I: 1, V: 5, X: 10 };
  let total = 0;
  let prev = 0;
  const chars = String(roman).toUpperCase().split('').reverse();
  for (const ch of chars) {
    const val = map[ch] || 0;
    if (val < prev) total -= val;
    else total += val;
    prev = val;
  }
  return total;
}

/**
 * Main entry point.
 * Logs in with the student's HTNo and returns their latest semester result.
 */
async function scrapeResult(htno) {
  const client    = createClient();
  const htnoUpper = htno.toUpperCase().trim();

  // ── Step 1: GET Login page ──────────────────────────────────────────
  let r1;
  try {
    r1 = await client.get(LOGIN_URL);
  } catch (err) {
    throw new Error(`Cannot reach AEC portal: ${err.message}`);
  }

  let $ = cheerio.load(r1.data);

  // ── Step 2: Trigger doPostBack('lnkStudent','') to show login form ──
  let r2;
  try {
    r2 = await client.post(
      LOGIN_URL,
      encodeBody(Object.assign({}, extractFormFields($), {
        __EVENTTARGET: 'lnkStudent', __EVENTARGUMENT: '',
      })),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: LOGIN_URL },
        validateStatus: function(s) { return s < 500; },
      }
    );
  } catch (err) {
    throw new Error(`Failed to load login form: ${err.message}`);
  }

  if (!r2.data.includes('txtUserId')) {
    throw new Error('Could not load student login form. Portal structure may have changed.');
  }

  // ── Step 3: POST credentials ────────────────────────────────────────
  $ = cheerio.load(r2.data);
  const loginUrl = (r2.request && r2.request.res && r2.request.res.responseUrl) || LOGIN_URL;

  let r3;
  try {
    r3 = await client.post(
      loginUrl,
      encodeBody(Object.assign({}, extractFormFields($), {
        __EVENTTARGET: '', __EVENTARGUMENT: '',
        txtUserId: htnoUpper, txtPwd: htnoUpper, btnLogin: 'Login',
      })),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: loginUrl },
        validateStatus: function(s) { return s < 500; },
      }
    );
  } catch (err) {
    throw new Error(`Login POST failed: ${err.message}`);
  }

  const postHtml = typeof r3.data === 'string' ? r3.data : '';
  if (!postHtml.includes('Student Portal') && !postHtml.includes('MainStud')) {
    throw new Error('Invalid Hall Ticket Number or login failed. Please verify your HTNo.');
  }

  // ── Step 4: GET the marks page (defaults to latest semester) ────────
  let marksResp;
  try {
    marksResp = await client.get(MARKS_URL, {
      headers: {
        Referer: (r3.request && r3.request.res && r3.request.res.responseUrl) || BASE_URL,
      },
    });
  } catch (err) {
    throw new Error(`Cannot fetch marks page: ${err.message}`);
  }

  const finalUrl = marksResp.request && marksResp.request.res && marksResp.request.res.responseUrl;
  if (finalUrl && finalUrl.includes('Login.aspx')) {
    throw new Error('Session not established. HTNo may be invalid.');
  }

  $ = cheerio.load(marksResp.data);

  // ── Step 5: Extract student info ────────────────────────────────────
  const bodyText = $('body').text().replace(/\s+/g, ' ');

  const htnoM   = bodyText.match(/HTNo\s*:\s*([A-Z0-9]+)/i);
  const nameM   = bodyText.match(/Name\s*:\s*([A-Z][A-Z\s]+?)(?:Branch|Sem\b)/i);
  const branchM = bodyText.match(/Branch\s*:\s*([A-Z]+)/i);
  const semM    = bodyText.match(/Sem\s*:\s*((?:[IVX]+\s+)?SEMESTER)/i);

  const studentInfo = {
    htno:       htnoM   ? htnoM[1].trim()   : htnoUpper,
    name:       nameM   ? nameM[1].trim()   : '',
    branch:     branchM ? branchM[1].trim() : '',
    currentSem: semM    ? semM[1].trim()    : '',
  };

  // ── Step 6: Parse summary values ────────────────────────────────────
  const cgpaM    = bodyText.match(/Final\s+CGPA\s*:\s*([\d.]+)/i);
  const creditsM = bodyText.match(/Total\s+Credits\s+Obtained\s*:\s*([\d.]+)/i);
  const dueM     = bodyText.match(/Due\s+Courses\s*:\s*(\d+)\/(\d+)/i);

  const cgpa         = cgpaM    ? cgpaM[1]    : null;
  const totalCredits = creditsM ? creditsM[1] : null;
  const backlogs     = dueM     ? dueM[1]     : '0'; // numerator = number of due courses

  // ── Step 7: Select latest published semester ────────────────────────
  // Portal provides semester buttons (btn1..btnN) only for published semesters.
  const semButtons = [];
  $('input[id^="ctl00_cpStudCorner_btn"]').each(function(i, el) {
    const id = ($(el).attr('id') || '').trim();
    const name = ($(el).attr('name') || '').trim();
    const value = ($(el).attr('value') || '').trim().toUpperCase();
    const inputType = ($(el).attr('type') || '').trim().toLowerCase();
    const m = id.match(/btn(\d+)$/i);
    const index = m ? parseInt(m[1], 10) : 0;
    const isSemButton = value.includes('SEMESTER');
    if (name && value && index > 0 && isSemButton && (inputType === '' || inputType === 'submit' || inputType === 'button')) {
      semButtons.push({ id, name, value, index });
    }
  });

  // Keep the enrolled/current semester as a fallback only.
  const enrolledSemLabel = (
    $('span#ctl00_lblSem').text().trim() ||
    $('span[id*="lblSem"]').text().trim()
  ).toUpperCase();

  let latestSemLabel = enrolledSemLabel;

  if (semButtons.length > 0) {
    semButtons.sort(function(a, b) {
      // Prefer numeric index, then Roman value from label as a tie-breaker.
      if (a.index !== b.index) return b.index - a.index;
      const aRoman = (a.value.match(/^([IVX]+)\s+SEMESTER$/i) || [])[1] || '';
      const bRoman = (b.value.match(/^([IVX]+)\s+SEMESTER$/i) || [])[1] || '';
      return romanToInt(bRoman) - romanToInt(aRoman);
    });

    const targetSem = semButtons[0];
    latestSemLabel = targetSem.value;

    // Click-like POST for target semester to load its rows into grdSemwise.
    try {
      const semResp = await client.post(
        MARKS_URL,
        encodeBody(Object.assign({}, extractFormFields($), {
          [targetSem.name]: targetSem.value,
        })),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: MARKS_URL,
          },
          validateStatus: function(s) { return s < 500; },
        }
      );
      $ = cheerio.load(semResp.data);
    } catch (err) {
      // Continue with initial page content on semester-select failure.
      console.warn('[scraper] Semester select failed:', err.message);
    }
  }

  // Fallback if all labels are absent
  if (!latestSemLabel) {
    $('td').each(function(i, el) {
      const txt = $(el).text().replace(/\s+/g, ' ').trim();
      if (!latestSemLabel && /^([IVX]{1,4})\s+SEMESTER$/i.test(txt)) {
        latestSemLabel = txt.toUpperCase();
      }
    });
  }

  // ── Step 8: Parse the marks table ───────────────────────────────────
  const courses = [];
  $('table').each(function(ti, table) {
    const firstRowText = $(table).find('tr').first().text().toLowerCase();
    if (!firstRowText.includes('course code') || !firstRowText.includes('grade')) return;

    $(table).find('tr').slice(1).each(function(i, row) {
      const cells = $(row).find('td').map(function(j, td) {
        return $(td).text().replace(/\s+/g, ' ').trim();
      }).get();

      // Portal columns: siNo | (img) | courseCode | courseName | monthYear | grade | credits | status
      if (cells.length >= 6 && cells[2] && /^\d{3}[A-Z]/.test(cells[2])) {
        courses.push({
          siNo:       cells[0] || String(i + 1),
          courseCode: cells[2] || '',
          courseName: cells[3] || '',
          grade:      cells[5] || '',
          credits:    cells[6] || '',
          status:     cells[7] || '',
        });
      }
    });
    return false; // stop after the first matching table
  });

  return {
    studentInfo,
    cgpa,
    totalCredits,
    backlogs,
    latestSemLabel,
    courses,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { scrapeResult };
