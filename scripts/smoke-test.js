// Simple smoke tests for AEC Result System
// Requires Node 18+ (global fetch)

async function check(url, expectSuccess = true) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      if (!expectSuccess && res.status >= 400 && res.status < 500) {
        console.log('OK', url, '(expected failure - status ' + res.status + ')');
        return true;
      }
      console.error('FAIL', url, res.status, json || await res.text());
      process.exitCode = 2;
      return false;
    }
    if (expectSuccess && json && json.success === false) {
      console.error('FAIL', url, '(returned success:false)', json);
      process.exitCode = 2;
      return false;
    }
    console.log('OK', url, json && json.success ? '(success)' : '(status ' + res.status + ')');
    return true;
  } catch (err) {
    console.error('ERROR', url, err.message);
    process.exitCode = 3;
    return false;
  }
}

async function run() {
  const base = process.env.BASE_URL || 'http://localhost:3000';
  console.log('Running smoke tests against', base);
  await check(base + '/api/stats');
  await check(base + '/api/cache/list');
  // non-existent HTNo to validate 400 handling
  await check(base + '/api/result/INVALID_HTNO', false);
  console.log('Smoke tests finished (exit code', process.exitCode || 0, ')');
}

run();
