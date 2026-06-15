// Download fandom lore artwork for the mnemonic-name numbers and resize to 256x144
// (same as the Dota2 hero portraits). Output: dota2/img/<id>.png
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const imgDir = "/home/yu/my/anki/dota2/img";
const UA = "Mozilla/5.0 (research)";

// number -> exact File: name on dota2.fandom.com
const FILES = {
  2:  "Lore Papa Samet.jpg",
  46: "Lore Fymryn.jpg",
  51: "Lore Balimar Oakrot.png",
  65: "Hill Troll model.png",
  66: "Nico Hieronimo Lore.png",
  68: "Nikdo Anime.png",
  75: "Mirana's Grandpa Portrait idk Anime.png",
  96: "Lore Lyla.jpg",
  99: "Lore Lommett.jpg",
};

async function urlFor(file) {
  const api = `https://dota2.fandom.com/api.php?action=query&titles=${encodeURIComponent("File:" + file)}&prop=imageinfo&iiprop=url&format=json`;
  const j = await (await fetch(api, { headers: { "User-Agent": UA } })).json();
  const pages = j.query.pages;
  const p = pages[Object.keys(pages)[0]];
  return p.imageinfo && p.imageinfo[0] ? p.imageinfo[0].url : null;
}

async function main() {
  for (const [id, file] of Object.entries(FILES)) {
    try {
      const url = await urlFor(file);
      if (!url) { console.log(`${id} ${file} -> no url`); continue; }
      const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": UA } })).arrayBuffer());
      const tmp = `/tmp/lore_${id}`;
      fs.writeFileSync(tmp, buf);
      // cover-crop to 256x144, gravity north (keep heads/faces), output png
      execFileSync("magick", [tmp, "-resize", "256x144^", "-gravity", "north",
        "-extent", "256x144", path.join(imgDir, `${id}.png`)]);
      console.log(`${id} ${file} -> img/${id}.png`);
    } catch (e) {
      console.log(`${id} ${file} -> FAIL ${e.message}`);
    }
  }
}
main();
