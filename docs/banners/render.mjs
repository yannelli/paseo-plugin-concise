// Renders the configuration and playground README banners from 1440x900 captures taken at 2x.
// Usage: node docs/banners/render.mjs [captures-dir] [out-dir]   (captures-dir defaults to docs/banners/captures)
//        node docs/banners/render.mjs --calibrate <old-configuration-banner.png> <out.png>
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : require('playwright');
const root = fileURLToPath(new URL('.', import.meta.url));
const WIDTH = 960;
const HEIGHT = 540;
const CARD_BOTTOM = HEIGHT - 56;
const MAX_BYTES = 600 * 1024;

const banners = [
  {
    name: 'configuration-light',
    capture: 'configuration.png',
    headline: ['Set writing <em>rules</em>', 'per project'],
    cards: [
      { alt: 'Project (Claude) configuration file with the Dictionary section open', crop: [376, 120, 520, 300 / 0.9], scale: 0.9, left: 132, top: 184, fade: { right: 115, bottom: 48 } },
      { alt: 'Two saved dictionary entries: blacklist and hope-this-helps', crop: [376, 436, 440, 164], scale: 0.9, left: 432, top: 336.4, fade: { right: 115 } },
    ],
  },
  {
    name: 'playground',
    capture: 'playground.png',
    headline: ['Test a rule on', '<em>your own</em> text'],
    cards: [
      { alt: 'Playground with File write selected and a two-line file', crop: [376, 83, 414, 375], scale: 0.8, left: 113.5, top: 184, fade: { right: 80 } },
      { alt: 'Rejected result with the check-edit deny verdict, reason, and findings', crop: [376, 473, 580, 298], scale: 0.85, left: 353.5, top: 230.7, fade: { right: 30 }, outline: [391, 525, 109, 24] },
    ],
  },
];

async function pngSize(file) {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG', `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function render(tab, banner, source, output, limits) {
  const { width } = await pngSize(source);
  const src = pathToFileURL(source).href;
  const cards = banner.cards.map((card) => ({ ...card, src, captureWidth: width / 2 }));
  await tab.goto(pathToFileURL(join(root, 'banner.html')).href);
  const layout = await tab.evaluate((spec) => window.renderBanner(spec), { headline: banner.headline, cards });
  assert.equal(layout.fonts, true, 'Geist fonts did not load');
  assert(layout.headline.width <= WIDTH, 'headline overflows');
  for (const rect of layout.cards) {
    assert(rect.left >= 0 && rect.right <= WIDTH, `${banner.name}: card outside the frame`);
    assert(rect.top >= layout.headline.bottom - 8, `${banner.name}: card overlaps the headline`);
    assert(Math.abs(rect.bottom - CARD_BOTTOM) < 0.5, `${banner.name}: each card must end at ${CARD_BOTTOM}px`);
  }
  await tab.screenshot({ path: output });
  assert.deepEqual(await pngSize(output), { width: WIDTH * 2, height: HEIGHT * 2 });
  const { size } = await stat(output);
  if (limits) assert(size < MAX_BYTES, `${output} is ${size} bytes`);
  console.log(`${output}: ${WIDTH * 2}x${HEIGHT * 2}, ${Math.round(size / 1024)} KB, cards ${JSON.stringify(layout.cards)}`);
}

const args = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  const tab = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  const failures = [];
  tab.on('pageerror', (error) => failures.push(error.message));
  if (args[0] === '--calibrate') {
    assert(args[1] && args[2], 'usage: render.mjs --calibrate <old-banner.png> <out.png>');
    const calibration = {
      name: 'calibration',
      headline: ['Set writing <em>rules</em>', 'per project'],
      cards: [{ alt: 'Old card', crop: [183, 184, 594, 300], scale: 1, left: 183, top: 184 }],
    };
    await render(tab, calibration, resolve(args[1]), resolve(args[2]), false);
  } else {
    const outDir = resolve(args[1] ?? join(root, '..', 'images'));
    for (const banner of banners) {
      await render(tab, banner, resolve(args[0] ?? join(root, 'captures'), banner.capture), join(outDir, `${banner.name}.png`), true);
    }
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
