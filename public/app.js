/* ═══════════════════════════════════════════════════
   AEC Smart Results — Frontend Logic (Simplified)
   ═══════════════════════════════════════════════════ */

// ── DOM refs ──────────────────────────────────────────────
const htnoInput      = document.getElementById('htnoInput');
const fetchBtn       = document.getElementById('fetchBtn');
const forceToggle    = document.getElementById('forceToggle');
const loadingSection = document.getElementById('loadingSection');
const errorSection   = document.getElementById('errorSection');
const resultSection  = document.getElementById('resultSection');
let loaderTimer = null;
let updatePollTimer = null;
let lastRenderedSemLabel = null;

// ── Init ──────────────────────────────────────────────────
fetchBtn.addEventListener('click', handleFetch);
htnoInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleFetch(); });
htnoInput.addEventListener('input', function() {
  var pos = htnoInput.selectionStart;
  htnoInput.value = htnoInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  htnoInput.setSelectionRange(pos, pos);
});
document.getElementById('retryBtn').addEventListener('click', showSearch);
document.getElementById('newSearchBtn').addEventListener('click', function() {
  showSearch(); htnoInput.value = ''; htnoInput.focus();
});
document.getElementById('forceRefreshBtn').addEventListener('click', function() {
  forceToggle.checked = true; handleFetch();
});

// Stats polling
loadStats();
setInterval(loadStats, 10000);

// ── Visibility ────────────────────────────────────────────
function showSearch() {
  hide(loadingSection); hide(errorSection); hide(resultSection);
}
function hide(el) { el.classList.add('hidden'); }
function show(el) { el.classList.remove('hidden'); }

// ── Loader animation ──────────────────────────────────────
function startLoader() {
  show(loadingSection); hide(errorSection); hide(resultSection);
  var steps = ['ls1','ls2','ls3'];
  steps.forEach(function(id) { document.getElementById(id).className = 'lstep'; });
  document.getElementById('ls1').classList.add('active');
  var i = 0;
  loaderTimer = setInterval(function() {
    if (i > 0 && i < steps.length) {
      document.getElementById(steps[i-1]).classList.replace('active','done');
    }
    i++;
    if (i < steps.length) document.getElementById(steps[i]).classList.add('active');
    else clearInterval(loaderTimer);
  }, 4000);
}

// ── Fetch ─────────────────────────────────────────────────
async function handleFetch() {
  var htno = htnoInput.value.trim().toUpperCase();
  if (!htno || htno.length < 8) {
    htnoInput.style.boxShadow = '0 0 0 2px var(--danger)';
    setTimeout(function() { htnoInput.style.boxShadow = ''; }, 1500);
    htnoInput.focus(); return;
  }

  fetchBtn.disabled = true;
  startLoader();

  try {
    var force = forceToggle.checked;
    var url = '/api/result/' + encodeURIComponent(htno) + (force ? '?force=true' : '');
    var res  = await fetch(url);
    var json = await res.json();
    clearInterval(loaderTimer);

    if (!res.ok || !json.success) {
      showError(json.error || 'Failed to fetch result.', json.suggestion || '');
      return;
    }

    renderResult(json);
    // Track the label we just rendered
    lastRenderedSemLabel = (json.data && (json.data.latestSemLabel || json.data.studentInfo.currentSem)) || null;
    // Start a short-lived background poll to detect new semester updates
    startUpdatePoll(htno, lastRenderedSemLabel);
    show(resultSection); hide(loadingSection);
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    loadStats();

  } catch (err) {
    clearInterval(loaderTimer);
    showError('Network error — cannot reach the server.', 'Make sure the server is running on port 3000.');
  } finally {
    fetchBtn.disabled = false;
    forceToggle.checked = false;
  }
}

// ── Background poll to auto-update when a new semester becomes available
function startUpdatePoll(htno, currentLabel) {
  // Clear any existing poll
  if (updatePollTimer) clearInterval(updatePollTimer);
  if (!htno) return;
  var attempts = 0;
  updatePollTimer = setInterval(async function() {
    attempts++;
    if (attempts > 12) { // stop after ~3 minutes (12 * 15s)
      clearInterval(updatePollTimer); updatePollTimer = null; return;
    }
    try {
      var res = await fetch('/api/result/' + encodeURIComponent(htno));
      var json = await res.json();
      if (res.ok && json.success) {
        var newLabel = (json.data && (json.data.latestSemLabel || json.data.studentInfo.currentSem)) || null;
        if (newLabel && currentLabel && newLabel.toUpperCase() !== currentLabel.toUpperCase()) {
          // New semester detected — re-render and notify
          renderResult(json);
          lastRenderedSemLabel = newLabel;
          clearInterval(updatePollTimer); updatePollTimer = null;
          var note = document.getElementById('updateNote');
          if (note) { note.textContent = 'Updated to latest semester automatically.'; note.classList.add('visible'); setTimeout(function(){ note.classList.remove('visible'); }, 6000); }
        }
      }
    } catch (e) {
      // ignore network errors for poll
    }
  }, 15000);
}

// ── Render Result ─────────────────────────────────────────
function renderResult(json) {
  var d = json.data;

  // ── Summary cards ──────────────────────────────────────
  // CGPA ring
  var cgpaNum = parseFloat(d.cgpa) || 0;
  document.getElementById('cgpaNum').textContent = d.cgpa || '—';
  setTimeout(function() {
    // circumference = 2π×40 ≈ 251.3
    document.getElementById('cgpaCircle').style.strokeDashoffset = 251 - (cgpaNum / 10) * 251;
  }, 80);

  // Credits
  document.getElementById('creditsVal').textContent = d.totalCredits || '—';

  // Backlogs
  var bl = parseInt(d.backlogs) || 0;
  document.getElementById('backlogsVal').textContent = bl;
  document.getElementById('backlogsIcon').textContent = bl > 0 ? '⚠️' : '✅';
  var bCard = document.getElementById('backlogsCard');
  if (bl > 0) bCard.classList.add('backlog-warn');
  else bCard.classList.remove('backlog-warn');

  // Semester
  document.getElementById('semVal').textContent = d.latestSemLabel || d.studentInfo.currentSem || '—';

  // ── Student strip ──────────────────────────────────────
  var name = d.studentInfo.name || d.studentInfo.htno;
  document.getElementById('studentName').textContent = name || '—';
  document.getElementById('metaHTNo').textContent    = 'HTNo: ' + d.studentInfo.htno;
  document.getElementById('metaBranch').textContent  = d.studentInfo.branch || 'AEC';

  var initials = name ? name.split(' ').filter(Boolean).map(function(w){return w[0];}).join('').slice(0,2).toUpperCase() : '??';
  document.getElementById('studentAvatar').textContent = initials;

  // Source pill
  var pill = document.getElementById('sourcePill');
  if (json.source === 'cache') {
    pill.textContent = '⚡ Served from cache';
    pill.className = 'source-pill';
    if (json.ageMs) pill.textContent += ' · ' + formatAge(json.ageMs) + ' ago';
  } else {
    pill.textContent = '🔄 Fresh from portal';
    pill.className = 'source-pill fresh';
  }

  // ── Grades table ───────────────────────────────────────
  document.getElementById('semLabel').textContent  = d.latestSemLabel || '—';
  document.getElementById('gradesCount').textContent = d.courses.length + ' course' + (d.courses.length !== 1 ? 's' : '');

  var tbody = document.getElementById('gradesBody');
  tbody.innerHTML = '';

  if (!d.courses || d.courses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:36px">No published course data found for this semester yet.</td></tr>';
    return;
  }

  d.courses.forEach(function(c, i) {
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="color:var(--text2);font-size:.8rem">' + esc(c.siNo) + '</td>' +
      '<td><code style="font-family:monospace;font-size:.82rem;color:var(--accent2)">' + esc(c.courseCode) + '</code></td>' +
      '<td style="font-weight:500">' + esc(c.courseName) + '</td>' +
      '<td>' + gradePill(c.grade) + '</td>' +
      '<td style="text-align:center;font-weight:600">' + esc(c.credits) + '</td>' +
      '<td>' + statusHtml(c.status) + '</td>';
    tr.style.animation = 'fadeInRow .3s ease ' + (i * 0.04) + 's both';
    tbody.appendChild(tr);
  });
}

// ── Grade Pill ────────────────────────────────────────────
function gradePill(grade) {
  if (!grade) return '<span class="grade-pill gX">—</span>';
  var g = grade.trim().toUpperCase();
  var map = { O:'gO', A:'gA', B:'gB', C:'gC', D:'gD', F:'gF', S:'gS' };
  var cls = map[g] || 'gX';
  return '<span class="grade-pill ' + cls + '">' + esc(grade) + '</span>';
}

function statusHtml(status) {
  if (!status) return '<span style="color:var(--text2)">—</span>';
  var s = status.trim().toUpperCase();
  if (s === 'PASS') return '<span class="status-pass">✓ PASS</span>';
  if (s === 'FAIL') return '<span class="status-fail">✗ FAIL</span>';
  return '<span style="color:var(--text2)">' + esc(status) + '</span>';
}

// ── Error ─────────────────────────────────────────────────
function showError(msg, hint) {
  document.getElementById('errMsg').textContent  = msg;
  document.getElementById('errHint').textContent = hint || '';
  hide(loadingSection); hide(resultSection); show(errorSection);
}

// ── Stats ─────────────────────────────────────────────────
async function loadStats() {
  try {
    var res  = await fetch('/api/stats');
    var json = await res.json();
    if (!json.success) return;
    var s = json.stats;
    document.getElementById('sHits').textContent   = fmt(s.hits);
    document.getElementById('sMisses').textContent = fmt(s.misses);
    document.getElementById('sRate').textContent   = s.hitRate + '%';
    document.getElementById('sSize').textContent   = fmt(s.size);
    var badge = document.getElementById('liveBadge');
    badge.textContent = '● Live';
    badge.style.color = 'var(--success)';
  } catch (_) {
    var badge2 = document.getElementById('liveBadge');
    badge2.textContent = '● Offline';
    badge2.style.color = 'var(--danger)';
  }
}

// ── Helpers ───────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n) {
  return (n === undefined || n === null) ? '—' : Number(n).toLocaleString();
}
function formatAge(ms) {
  var s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
