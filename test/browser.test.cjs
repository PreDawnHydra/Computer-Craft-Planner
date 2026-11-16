// Loads the built page in Chromium, types into CraftOS, and saves a screenshot.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:4173/';
  const out = process.argv[3] || 'screenshot.png';
  const cmds = process.argv.slice(4);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
  page.on('console', m => console.log('console:', m.type(), m.text()));
  page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.click('.cc-term');
  // "!key:Name" presses a key, "!wait:ms" waits, "!reload" reloads, "!type:text" types without Enter
  for (const c of cmds) {
    if (c.startsWith('!key:')) { await page.keyboard.press(c.slice(5)); await page.waitForTimeout(150); }
    else if (c.startsWith('!wait:')) await page.waitForTimeout(+c.slice(6));
    else if (c === '!reload') { await page.waitForTimeout(800); await page.reload(); await page.waitForTimeout(1500); await page.click('.cc-term'); }
    else if (c.startsWith('!type:')) { await page.keyboard.type(c.slice(6), { delay: 5 }); }
    else if (c.startsWith('!click:')) { const [x, y] = c.slice(7).split(',').map(Number); const b = await page.locator('.cc-term').boundingBox(); await page.mouse.click(b.x + x, b.y + y); await page.waitForTimeout(200); }
    else {
      await page.keyboard.type(c, { delay: 5 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: out });
  await browser.close();
})();
