import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
  : require('playwright');
const root = fileURLToPath(new URL('.', import.meta.url));
const shapes = `<path d="M160 272h260c34 0 58 12 82 36l136 140c14 15 32 24 52 24v80c-46 0-84-16-114-47L438 364c-6-6-14-10-22-10H160Z"/>
<path d="M160 752h260c34 0 58-12 82-36l136-140c14-15 32-24 52-24v-80c-46 0-84 16-114 47L438 660c-6 6-14 10-22 10H160Z"/>
<path d="M160 460h530v104H160Z"/><rect x="728" y="460" width="136" height="104" rx="22"/>`;
const mark = (className = '') => `<svg class="${className}" viewBox="160 272 704 480" aria-hidden="true" fill="currentColor">${shapes}</svg>`;
const captures = {
  hero: { file: 'hero', box: [925, 946, 790, 580], width: 800, left: 76, top: 102 },
  activity: { file: 'activity', box: [750, 528, 1120, 730], width: 850, left: 51, top: 120 },
  configuration: { file: 'configuration-light', box: [750, 1220, 1100, 580], width: 850, left: 51, top: 167 },
  playground: { file: 'playground', box: [752, 408, 1600, 760], width: 850, left: 51, top: 186 },
};
const banners = [
  { name: 'composer', label: 'In your composer', title: 'Keep agent<br>edits<br><em>concise.</em>', description: 'Check activity. Toggle enforcement.', capture: 'hero' },
  { name: 'activity', label: 'Live activity', title: 'See why<br>edits get<br><em>blocked.</em>', description: 'The edit. The rule. The reason.', capture: 'activity' },
  { name: 'configuration', label: 'Project settings', title: 'Set limits.<br><em>Per project.</em>', description: 'Comments, files, and writing style.', capture: 'configuration' },
  { name: 'playground', label: 'Rule playground', title: 'Try rules<br>on your<br><em>own text.</em>', description: 'Preview without changing files.', capture: 'playground' },
  { name: 'mobile', label: 'On your phone', title: 'Check edits.<br><em>On the go.</em>', description: 'Activity and controls in Paseo.', capture: 'phones' },
];

async function pngSize(file) {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function captureMarkup(theme, name) {
  if (name === 'phones') {
    return ['compact-composer', 'compact-activity'].map((file, index) =>
      `<div class="capture phone" style="left:${130 + index * 361}px;top:58px;width:330px">
        <img src="../assets/${theme}/${file}.png" alt="${file === 'compact-composer' ? 'Composer sheet' : 'Activity feed'} in Paseo at phone width">
      </div>`).join('');
  }
  const { file, box, width, left, top } = captures[name];
  const source = await pngSize(join(root, 'assets', theme, `${file}.png`));
  const [x, y, cropWidth, cropHeight] = box;
  assert(x + cropWidth <= source.width && y + cropHeight <= source.height);
  const scale = (width - 16) / cropWidth;
  return `<div class="capture" style="left:${left}px;top:${top}px;width:${width}px;height:${cropHeight * scale + 16}px">
    <img src="../assets/${theme}/${file}.png" alt="Be concise ${name} in Paseo"
      style="width:${source.width * scale}px;height:${source.height * scale}px;left:${-x * scale}px;top:${-y * scale}px">
  </div>`;
}

function page(banner, theme, capture, index) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${banner.label}</title>
    <link rel="stylesheet" href="../banner.css"></head><body class="theme-${theme}">
    <div class="brand">${mark()}<div>be concise <span>/ Paseo</span></div></div>
    <main class="copy"><div class="eyebrow">${banner.label}</div><h1>${banner.title}</h1><p class="description">${banner.description}</p></main>
    <div class="stage">${mark('watermark')}<div class="stage-label">be concise in Paseo</div>${capture}</div>
    <footer><span>yannelli/paseo-plugin-concise</span><span class="page-number">0${index + 1} / 05</span></footer>
    </body></html>`;
}

const browser = await chromium.launch({ headless: true });
try {
  const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const failures = [];
  tab.on('pageerror', (error) => failures.push(error.message));
  for (const theme of ['dark', 'light']) {
    await mkdir(join(root, theme), { recursive: true });
    for (const [index, banner] of banners.entries()) {
      const htmlPath = join(root, theme, `${banner.name}.html`);
      await writeFile(htmlPath, page(banner, theme, await captureMarkup(theme, banner.capture), index));
      await tab.goto(pathToFileURL(htmlPath).href);
      await tab.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map((image) => image.decode()));
      });
      const geometry = await tab.evaluate(() => {
        const copy = document.querySelector('.copy').getBoundingClientRect();
        const stage = document.querySelector('.stage').getBoundingClientRect();
        return {
          separated: copy.right < stage.left,
          font: document.fonts.check('750 114px Geist'),
          capturesFit: [...document.querySelectorAll('.capture')].every((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left >= stage.left && rect.right <= stage.right && rect.bottom <= stage.bottom - 30;
          }),
          textFits: document.querySelector('h1').scrollWidth <= copy.width,
        };
      });
      assert.deepEqual(geometry, { separated: true, font: true, capturesFit: true, textFits: true });
      const output = join(root, theme, `${banner.name}.png`);
      await tab.screenshot({ path: output });
      assert.deepEqual(await pngSize(output), { width: 1920, height: 1080 });
      console.log(`${theme}/${banner.name}.png: 1920x1080, assets and layout checked`);
    }
  }
  assert.deepEqual(failures, []);
  const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Be concise: Codex design pass</title><style>
    @font-face{font-family:Geist;src:url('./assets/geist.woff2')}*{box-sizing:border-box}body{margin:0;padding:40px;background:#18191d;color:#faf7f2;font-family:Geist,sans-serif}
    header{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:36px}h1{font-size:28px;margin:0}p{color:#b9b6b1;font-size:15px}
    button{border:1px solid #64615d;border-radius:8px;background:transparent;color:inherit;padding:12px 16px;font:inherit;cursor:pointer}button[aria-pressed=true]{background:#ff4a24;border-color:#ff4a24}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}figure{margin:0}img{width:100%;display:block;border-radius:10px}figcaption{padding:10px 0;font-size:14px;color:#b9b6b1}
    body[data-theme=dark] .light,body[data-theme=light] .dark{display:none}@media(max-width:800px){body{padding:16px}.grid{grid-template-columns:1fr}header{align-items:start;flex-direction:column}}
    </style></head><body data-theme="both"><header><div><h1>Be concise / Codex design pass</h1><p>1920 × 1080 · Existing Paseo captures with sample data</p></div>
    <nav aria-label="Screenshot theme"><button data-theme="both" aria-pressed="true">Compare</button> <button data-theme="dark" aria-pressed="false">Dark UI</button> <button data-theme="light" aria-pressed="false">Light UI</button></nav></header>
    <main class="grid">${banners.map((banner) => ['dark', 'light'].map((theme) => `<figure class="${theme}"><a href="${theme}/${banner.name}.png"><img src="${theme}/${banner.name}.png" alt="${banner.label}, ${theme} theme"></a><figcaption>${banner.label} · ${theme} UI</figcaption></figure>`).join('')).join('')}</main>
    <script>document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{document.body.dataset.theme=button.dataset.theme;document.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)))}));</script></body></html>`;
  await writeFile(join(root, 'index.html'), gallery);
  await tab.setViewportSize({ width: 1600, height: 2450 });
  await tab.goto(pathToFileURL(join(root, 'index.html')).href);
  await tab.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((image) => image.decode())); });
  await tab.screenshot({ path: join(root, 'comparison.png'), fullPage: true });
  for (const theme of ['dark', 'light', 'both']) {
    await tab.locator(`button[data-theme="${theme}"]`).click();
    assert.equal(await tab.locator('figure:visible').count(), theme === 'both' ? 10 : 5);
  }
  await tab.setViewportSize({ width: 390, height: 844 });
  assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  console.log('Gallery: theme filters and mobile width checked');
} finally {
  await browser.close();
}
