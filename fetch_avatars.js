// Download official hero portraits into ./img/<id>.png.
// Source: OpenDota (hero list) + Steam Dota2 CDN (portrait PNGs).
// Run: node fetch_avatars.js
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const imgDir = path.join(dir, "img");
const CDN = s => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/${s}.png`;

const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");

// lore-alias / odd-spelling names -> Steam CDN shortname (no official auto-match)
const ALIAS = {
  7:  "mirana",              // Princess of the Moon
  16: "witch_doctor",        // Zharvakko
  60: "furion",              // Nature's Prophet
  81: "beastmaster",         // Karroch
  83: "keeper_of_the_light", // Keeper
  91: "templar_assassin",    // Lanaya
};

function namedRows() {
  const text = fs.readFileSync(path.join(dir, "data.csv"), "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d+),"[^"]*",([^,]*),/);
    if (m && m[2].trim()) rows.push({ id: +m[1], name: m[2].trim() });
  }
  return rows;
}

async function main() {
  fs.mkdirSync(imgDir, { recursive: true });

  const heroes = await (await fetch("https://api.opendota.com/api/heroes")).json();
  const byName = {};
  for (const h of heroes) byName[norm(h.localized_name)] = h.name.replace("npc_dota_hero_", "");

  const rows = namedRows();
  let ok = 0; const skipped = [];

  for (const r of rows) {
    const short = ALIAS[r.id] || byName[norm(r.name)];
    if (!short) { skipped.push(`${r.id} ${r.name}`); continue; }

    const res = await fetch(CDN(short));
    if (!res.ok) { skipped.push(`${r.id} ${r.name} (cdn ${res.status} for ${short})`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(imgDir, `${r.id}.png`), buf);
    ok++;
    process.stdout.write(".");
  }

  console.log(`\ndownloaded ${ok} portraits -> img/`);
  console.log(`no official avatar (${skipped.length}, made-up/lore names):\n  ` + skipped.join("\n  "));
}

main().catch(e => { console.error(e); process.exit(1); });
