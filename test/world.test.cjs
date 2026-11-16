// Drives the 3D world in Chromium: open the menu, enter the game, open a computer, type, close, place and break blocks.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:4173/';
  const dir = process.argv[3] || '.';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text()); });
  await page.goto(url);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: dir + '/w1-menu.png' });
  await page.click('[data-act=play]');
  await page.waitForTimeout(500);
  console.log('locked:', await page.evaluate(() => app.controls.locked), 'lockSupported:', await page.evaluate(() => app.controls.lockSupported));
  // moving the mouse while locked turns the camera; put it back to the spawn view
  await page.mouse.move(550, 350);
  await page.evaluate(() => { app.controls.yaw = 0; app.controls.pitch = -0.2; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: dir + '/w2-world.png' });
  // right click the computer in front of us
  console.log('before use:', await page.evaluate(() => JSON.stringify([app.controls.yaw, app.controls.pitch, app.target()?.pos])));
  await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(2000);
  console.log('gui open:', await page.evaluate(() => !!app.gui));
  await page.keyboard.type('ls', { delay: 10 }); await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: dir + '/w3-computer.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  // look down-left a bit and place blocks
  await page.evaluate(() => { app.controls.yaw = 0.6; app.controls.pitch = -0.5; });
  await page.waitForTimeout(100);
  for (const k of ['Digit3', 'Digit5', 'Digit6']) {
    await page.keyboard.press(k);
    await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
    await page.evaluate(() => { app.controls.pitch += 0.12; });
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => { app.controls.yaw = 0; app.controls.pitch = -0.2; });
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(800);
  await page.screenshot({ path: dir + '/w4-placed.png' });
  console.log('blocks:', await page.evaluate(() => app.world.blocks.size), 'computers:', await page.evaluate(() => app.computers.size));
  await browser.close();
})();
