const { test, expect } = require('@playwright/test');
const { loginAs } = require('./helpers');

test.describe('Global Chat', () => {
  test('open chat, send a message, it appears with sender + timestamp, and persists across reload', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="chat"]');
    await page.waitForSelector('#v-chat.view.active');
    await page.waitForSelector('#chatMessagesList');

    const uniqueText = 'E2E chat message ' + Date.now();
    await page.fill('#chatInput', uniqueText);
    await page.click('#chatSendBtn');

    const sentMsg = page.locator('.chat-msg', { hasText: uniqueText });
    await expect(sentMsg).toBeVisible();
    await expect(sentMsg.locator('.chat-sender')).toContainText('Admin User');
    await expect(sentMsg.locator('.chat-time')).not.toHaveText('');

    // Reload and confirm the message persisted server-side, not just in memory.
    await page.reload();
    await page.click('.navitem[data-view="chat"]');
    await page.waitForSelector('#v-chat.view.active');
    await expect(page.locator('.chat-msg', { hasText: uniqueText })).toBeVisible();
  });

  test('real-time delivery via SSE: a message sent in one browser context appears in another without a reload', async ({ page, browser }) => {
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();

    try {
      await loginAs(page, 'admin@greenwave.local');
      await page.click('.navitem[data-view="chat"]');
      await page.waitForSelector('#v-chat.view.active');

      // Real proof the second tab's EventSource actually connected (not a
      // stand-in): wait for the live network response to /chat/stream
      // itself, started before navigating to the chat view.
      const sseConnected = secondPage.waitForResponse(
        (res) => res.url().includes('/chat/stream') && res.status() === 200,
        { timeout: 10000 },
      );
      await loginAs(secondPage, 'manager@greenwave.local');
      await secondPage.click('.navitem[data-view="chat"]');
      await secondPage.waitForSelector('#v-chat.view.active');
      await sseConnected;

      const liveText = 'E2E SSE live message ' + Date.now();
      await page.fill('#chatInput', liveText);
      await page.click('#chatSendBtn');

      // No reload/navigation on secondPage, and a deadline tighter than the
      // app's 4s polling fallback interval — this only passes if the
      // message was actually pushed over the SSE stream, not picked up by
      // the poll.
      await expect(secondPage.locator('.chat-msg', { hasText: liveText })).toBeVisible({
        timeout: 2500,
      });
    } finally {
      await secondContext.close();
    }
  });

  test('sending an empty message is a no-op', async ({ page }) => {
    await loginAs(page, 'admin@greenwave.local');
    await page.click('.navitem[data-view="chat"]');
    await page.waitForSelector('#v-chat.view.active');
    // Let the initial GET /chat/messages load finish before taking the
    // baseline count, or a late-arriving history load can be mistaken for
    // messages the (incorrect) empty send produced. The static "Loading
    // messages…" placeholder also carries the .chat-empty class, so waiting
    // on ".chat-msg, .chat-empty" alone can match that placeholder itself
    // (before the real GET resolves) rather than the loaded result.
    await page.waitForFunction(() => {
      var el = document.querySelector('#chatMessagesList');
      return !!el && !el.textContent.includes('Loading messages');
    });

    const before = await page.locator('.chat-msg').count();
    await page.fill('#chatInput', '   ');
    await page.click('#chatSendBtn');
    // Give any (incorrect) send attempt a moment to round-trip.
    await page.waitForTimeout(500);
    const after = await page.locator('.chat-msg').count();
    expect(after).toBe(before);
  });
});
