const { chromium } = require('playwright');
const path = require('path');

const jobs = [
  { file: '1-dashboard.html', out: 'hc-showcase-01-dashboard.png', w: 1560 },
  { file: '2-landlords.html', out: 'hc-showcase-02-landlords.png', w: 1560 },
  { file: '3-team.html',      out: 'hc-showcase-03-team.png',      w: 1560 },
  { file: '4-wizard.html',    out: 'hc-showcase-04-wizard.png',    w: 1200 },
];

(async () => {
  const browser = await chromium.launch();
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.w, height: 900 }, deviceScaleFactor: 2 });
    await page.goto('file://' + path.resolve(__dirname, j.file));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.resolve(__dirname, '..', 'out', j.out), fullPage: true });
    await page.close();
    console.log('rendered', j.out);
  }
  await browser.close();
})();
