// Regenerate the cased-name field (col 7) of data.csv from the first 6 fields.
// Idempotent. Run: node build.js
const fs = require("fs");
const path = require("path");
const { makeDisp } = require("./logic");

const file = path.join(__dirname, "data.csv");

function rebuild(text) {
  return text.split(/\r?\n/).map(line => {
    const m = line.match(/^(\d+),"([^"]*)",(.*)$/);
    if (!m) return line;
    const id = m[1], combos = m[2];
    const rest = m[3].split(",");          // name,wiki,google,last[,disp]
    while (rest.length < 4) rest.push("");
    const name = rest[0].trim();
    const base = rest.slice(0, 4).join(",");
    const disp = name ? makeDisp(name, Math.floor(+id / 10), +id % 10) : "";
    return `${id},"${combos}",${base},${disp}`;
  }).join("\n");
}

if (require.main === module) {
  const out = rebuild(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(file, out);
  console.log("rebuilt data.csv");
}

module.exports = { rebuild };
