const API_BASE = 'http://127.0.0.1:4000';

// The API rate-limits POST /auth/login to 10 attempts/minute per IP+email
// (login-rate-limit.guard.ts) — a real security control, not a test bug.
// With many spec files each logging in per-test, a full suite run can
// exceed that within its first minute and start failing unrelated tests
// with a 429. Since this config runs a single worker (one process for the
// whole run), a plain module-level cache is safe: log in for real over the
// UI once per distinct account for the life of the run, and reuse that
// session token (written straight into sessionStorage, bypassing the login
// form and the rate-limited endpoint) for every later loginAs() call with
// the same email.
const tokenCache = {};

/**
 * Points the legacy app at the local NestJS API and signs in as the given
 * seeded dev user (see backend/database/seeds/001_dev_users.sql — all dev
 * accounts share the password "DevPassword123!").
 */
async function loginAs(page, email, password) {
  password = password || 'DevPassword123!';

  await page.addInitScript((base) => {
    window.localStorage.setItem('greenwave.apiBase', base);
  }, API_BASE);

  const cached = tokenCache[email];
  if (cached) {
    await page.addInitScript((token) => {
      window.sessionStorage.setItem('greenwave.session.token', token);
    }, cached);
    await page.goto('/');
    await page.waitForSelector('#nav', { timeout: 15000 });
    return;
  }

  await page.goto('/');
  await page.fill('#gateEmail', email);
  await page.fill('#gatePassword', password);
  await page.click('#signSubmit');
  await page.waitForSelector('#nav', { timeout: 15000 });

  const token = await page.evaluate(
    () => window.sessionStorage.getItem('greenwave.session.token'),
  );
  if (token) tokenCache[email] = token;
}

async function goToView(page, viewName) {
  await page.click('.navitem[data-view="' + viewName + '"]');
  await page.waitForSelector('#v-' + viewName + '.view', { state: 'visible' });
}

module.exports = { loginAs, goToView, API_BASE };
