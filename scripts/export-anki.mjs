import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const MIN = Number(process.env.EXPORT_MIN || 10);
const MAX = Number(process.env.EXPORT_MAX || 99);

function parseCsvRow(line) {
  const out = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/index.html`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Local server did not start');
}

const rows = (await readFile('data.csv', 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map(parseCsvRow)
  .map(cols => ({ number: Number(cols[0]), hero: (cols[2] || '').trim() }))
  .filter(x => Number.isInteger(x.number) && x.number >= MIN && x.number <= MAX);

const entries = rows.filter(x => x.hero);
const missing = rows.filter(x => !x.hero).map(x => x.number);

await mkdir('anki', { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: process.cwd(),
  stdio: 'ignore'
});

try {
  await waitForServer();

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 760, height: 760 },
    deviceScaleFactor: 2,
    colorScheme: 'light'
  });

  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('heroes loaded'));

  await page.addStyleTag({ content: `
    body { padding: 24px 32px !important; min-height: auto !important; }
    main { gap: 24px !important; }
    footer { display: none !important; }
    #num { pointer-events: none !important; }
  `});

  for (const { number, hero } of entries) {
    await page.locator('#num').fill(String(number));
    await page.locator('#num').dispatchEvent('input');

    await page.waitForFunction(n => {
      const input = document.querySelector('#num');
      const name = document.querySelector('#heroName');
      return Number(input?.value) === n && name && !name.classList.contains('empty');
    }, number);

    await page.waitForTimeout(80);
    await page.screenshot({
      path: `anki/${number}.png`,
      fullPage: true
    });
    console.log(`${number}: ${hero}`);
  }

  await browser.close();
} finally {
  server.kill('SIGTERM');
}

const csvEscape = s => `"${String(s).replaceAll('"', '""')}"`;
const manifest = [
  'number,hero,image',
  ...entries.map(({ number, hero }) => `${number},${csvEscape(hero)},${number}.png`)
].join('\n') + '\n';

await writeFile('anki/manifest.csv', manifest);
await writeFile('anki/missing.txt', missing.join('\n') + (missing.length ? '\n' : ''));

console.log(`Exported ${entries.length} screenshots.`);
console.log(`Missing mappings: ${missing.length ? missing.join(', ') : 'none'}`);
