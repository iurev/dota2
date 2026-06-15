// ---------------------------------------------------------------------------
// Pure logic shared by the browser (app.js), the build script, and the tests.
// No DOM here. Works in both <script> (browser global) and Node (module.exports).
// ---------------------------------------------------------------------------

// QWERTY left-hand column -> one digit. Every letter maps to exactly one digit.
const COL = {
  q:1, a:1, z:1,
  w:2, s:2, x:2,
  e:3, d:3, c:3,
  r:4, f:4, v:4,
  t:5, g:5, b:5,
  y:6, h:6, n:6,
  u:7, j:7, m:7,
  i:8, k:8,
  o:9, l:9,
  p:0,
};

const ROWS = {
  top:    "qwertyuiop",
  home:   "asdfghjkl",
  bottom: "zxcvbnm",
};

// n (1..99) -> [tens, ones]; null if out of range / not an integer.
function digitsOf(n) {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  return [Math.floor(n / 10), n % 10];
}

// Parse data.csv text -> { id: casedName }. Cased name: UPPERCASE letter = highlight.
// Line: id,"combos",name,wiki,google,last,disp  (only combos contains commas; it's quoted)
function parseCsv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d+),"[^"]*",(.*)$/);
    if (!m) continue;
    const f = m[2].split(",");        // name,wiki,google,last,disp
    const disp = (f[4] || "").trim();
    if (disp) out[parseInt(m[1], 10)] = disp;
  }
  return out;
}

// Uppercase letters of a cased name -> [{ ch, i }] (the highlighted letters).
function highlightedLetters(name) {
  const res = [];
  [...name].forEach((ch, i) => { if (/[A-Z]/.test(ch)) res.push({ ch, i }); });
  return res;
}

// Everything the UI needs for a number. heroes = parseCsv output.
function compute(n, heroes) {
  const d = digitsOf(n);
  if (!d) return { valid: false };
  const [tens, ones] = d;
  const name = heroes[n] || "";
  // keyboard letters whose column is one of the two digits
  const colKeys = new Set(
    Object.keys(COL).filter(ch => COL[ch] === tens || COL[ch] === ones)
  );
  // exact keys = uppercase letters of the name, lowercased
  const exactKeys = new Set(highlightedLetters(name).map(h => h.ch.toLowerCase()));
  return { valid: true, tens, ones, name, colKeys, exactKeys };
}

// ---- generator: turn an ALL-CAPS / plain name into the cased form ----

// Indices allowed to be highlighted: first two letters + every word-start letter.
// Connector / article words that are NOT highlightable (like "Queen *of* Pain").
const STOP = new Set(["of", "the", "a", "an", "and"]);

// Words of a name as { i: startIndex, w: lowercaseWord }. Apostrophes stay in-word.
function words(name) {
  const out = [];
  const re = /[A-Za-z][A-Za-z'’]*/g;
  let m;
  while ((m = re.exec(name))) out.push({ i: m.index, w: m[0].toLowerCase() });
  return out;
}

// Indices of the first letter of each word (all words, stop words included).
function wordStarts(name) {
  return words(name).map(x => x.i);
}

// Pick the two letter indices to highlight for [tens, ones].
// RULE (in priority order):
//   1. start letter of a meaningful word (skip connectors of/the/a/an/and)
//   2. start letter of any word (incl. connectors)
//   3. next sequential matching char (single-word fallback, e.g. ZEus, DOom)
function pick(name, tens, ones) {
  const lo = [...name.toLowerCase()];
  const W = words(name);
  const meaningful = W.filter(x => !STOP.has(x.w));

  const startFor = (col, after, list) => {
    const hit = list.find(x => x.i > after && COL[lo[x.i]] === col);
    return hit ? hit.i : undefined;
  };

  // i1 (tens)
  let i1 = startFor(tens, -1, meaningful);
  if (i1 === undefined) i1 = startFor(tens, -1, W);
  if (i1 === undefined) i1 = lo.findIndex(c => COL[c] === tens);
  if (i1 === undefined) i1 = -1;

  // i2 (ones): meaningful word start -> any word start -> sequential
  let i2 = startFor(ones, i1, meaningful);
  if (i2 === undefined) i2 = startFor(ones, i1, W);
  if (i2 === undefined) {
    i2 = -1;
    for (let i = i1 + 1; i < lo.length; i++) if (COL[lo[i]] === ones) { i2 = i; break; }
  }
  return [i1, i2];
}

// Build cased name: all lowercase except the two highlighted letters.
function makeDisp(name, tens, ones) {
  const [i1, i2] = pick(name, tens, ones);
  const arr = [...name.toLowerCase()];
  if (i1 >= 0) arr[i1] = arr[i1].toUpperCase();
  if (i2 >= 0) arr[i2] = arr[i2].toUpperCase();
  return arr.join("");
}

const API = {
  COL, ROWS, digitsOf, parseCsv, highlightedLetters, compute,
  wordStarts, pick, makeDisp,
};

if (typeof module !== "undefined" && module.exports) module.exports = API;
if (typeof window !== "undefined") Object.assign(window, API);
