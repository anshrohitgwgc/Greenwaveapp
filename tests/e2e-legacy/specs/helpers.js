const API_BASE = 'http://127.0.0.1:4000';

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

  await page.goto('/');
  await page.fill('#gateEmail', email);
  await page.fill('#gatePassword', password);
  await page.click('#signSubmit');
  await page.waitForSelector('#nav', { timeout: 15000 });
}

async function goToView(page, viewName) {
  await page.click('.navitem[data-view="' + viewName + '"]');
  await page.waitForSelector('#v-' + viewName + '.view', { state: 'visible' });
}

module.exports = { loginAs, goToView, API_BASE };
