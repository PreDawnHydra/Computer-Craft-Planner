// Milestone 3 check in Chromium: monitor, redstone lamp, disk drive and rednet between two computers.
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:4173/';
  const dir = process.argv[3] || '.';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  await page.goto(url);
  await page.waitForTimeout(2000);
  const open = (x, y, z) => page.evaluate(([x, y, z]) => { app.closeGui(); app.openComputer(app.world.get(x, y, z)); }, [x, y, z]);
  const log = (s) => console.log(new Date().toISOString().slice(14, 19), s);
  const type = async (line) => { log('type ' + line.slice(0, 30)); const t0 = Date.now(); await page.keyboard.type(line, { delay: 2 }); log('typed in ' + (Date.now() - t0)); await page.keyboard.press('Enter'); await page.waitForTimeout(400); };
  const screen = (id) => page.evaluate((id) => app.sim.computer(id).lastSnap.text.map((l) => l.trimEnd()).filter(Boolean).join('\n'), id);

  // second computer with modems on both backs
  await page.evaluate(() => {
    app.world.set(0, 1, -4, { type: 'modem', facing: 4 });
    app.world.set(5, 1, -3, { type: 'computer', facing: 4, id: app.world.nextComputerId++ });
    app.world.set(5, 1, -4, { type: 'modem', facing: 4 });
  });
  await page.waitForTimeout(1500);

  await open(5, 1, -3);
  await page.waitForTimeout(1500);
  await type('lua');
  await type('rednet.open("back") id, msg = rednet.receive(300) print("got", id, msg)');

  await open(0, 1, -3);
  await page.waitForTimeout(1500);
  await type('lua');
  await type('m = peripheral.wrap("top") m.setTextScale(1) m.setBackgroundColor(colors.blue) m.clear() m.setCursorPos(2,2) m.write("Hello from CraftOS!") return m.getSize()');
  await type('rs.setOutput("left", true) return peripheral.getType("top"), peripheral.getType("right"), peripheral.getType("back")');
  await page.evaluate(() => app.sim.send({ t: 'disk', x: -1, y: 1, z: -3, action: 'insert', diskId: 'new' }));
  await page.waitForTimeout(800);
  await type('local f = fs.open("disk/hello", "w") f.write("on a floppy") f.close() return disk.isPresent("right"), disk.getMountPath("right"), disk.getID("right"), fs.exists("disk/hello")');
  await type('rednet.open("back") return rednet.send(1, "ping over rednet")');
  await page.waitForTimeout(800);
  console.log('--- computer 0 ---\n' + await screen(0));
  console.log('--- computer 1 ---\n' + await screen(1));
  console.log('lamp:', JSON.stringify(await page.evaluate(() => app.world.get(1, 1, -3))));
  await page.evaluate(() => app.closeGui());
  await page.evaluate(() => { app.controls.pos.set(0.5, 2.6, 2.5); app.controls.yaw = 0; app.controls.pitch = 0.05; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: dir + '/m3.png' });
  await browser.close();
})();
