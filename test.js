// Unit tests. Run: node test.js   (exit 0 = all pass)
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const L = require("./logic");

const csvText = fs.readFileSync(path.join(__dirname, "data.csv"), "utf8");
const heroes = L.parseCsv(csvText);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL:", name, "\n      ", e.message); }
}
const eq = assert.strictEqual;
const deep = assert.deepStrictEqual;

// ---------------------------------------------------------------- COL map
test("COL covers all 26 letters", () => {
  const letters = "abcdefghijklmnopqrstuvwxyz".split("");
  for (const ch of letters) assert.ok(ch in L.COL, `missing ${ch}`);
  eq(Object.keys(L.COL).length, 26);
});

test("COL digit groups are correct", () => {
  const expect = {
    1:"qaz", 2:"wsx", 3:"edc", 4:"rfv", 5:"tgb",
    6:"yhn", 7:"ujm", 8:"ik", 9:"ol", 0:"p",
  };
  for (const [dig, group] of Object.entries(expect))
    for (const ch of group) eq(L.COL[ch], Number(dig), `${ch} -> ${dig}`);
});

test("ROWS contain each letter exactly once", () => {
  const all = (L.ROWS.top + L.ROWS.home + L.ROWS.bottom).split("").sort().join("");
  eq(all, "abcdefghijklmnopqrstuvwxyz");
});

// ---------------------------------------------------------------- digitsOf
test("digitsOf boundaries", () => {
  deep(L.digitsOf(1),  [0, 1]);
  deep(L.digitsOf(9),  [0, 9]);
  deep(L.digitsOf(10), [1, 0]);
  deep(L.digitsOf(19), [1, 9]);
  deep(L.digitsOf(23), [2, 3]);
  deep(L.digitsOf(99), [9, 9]);
});

test("digitsOf rejects bad input", () => {
  for (const bad of [0, -1, 100, 1.5, NaN, Infinity, "5", null, undefined])
    eq(L.digitsOf(bad), null, `should reject ${bad}`);
});

// ---------------------------------------------------------------- parseCsv
test("parseCsv finds the named heroes", () => {
  eq(heroes[1], "Phantom Assassin");
  eq(heroes[10], "Queen of Pain");
  eq(heroes[19], "ALchemist");
  eq(heroes[20], "SPectre");
  eq(heroes[23], "Shadow Demon");
  eq(heroes[89], "IO");
});

test("parseCsv skips empty-name numbers", () => {
  for (const empty of [4, 40, 70, 80, 84, 85, 88, 90])
    assert.ok(!(empty in heroes), `${empty} should be absent`);
});

test("parseCsv tolerates blank / junk lines", () => {
  const h = L.parseCsv('\n  \n1,"pq,pa,pz",X,,,,Phantom Assassin\ngarbage\n');
  eq(h[1], "Phantom Assassin");
  eq(Object.keys(h).length, 1);
});

// ---------------------------------------------------------------- makeDisp
test("makeDisp matches the agreed format", () => {
  eq(L.makeDisp("SHADOW DEMON", 2, 3), "Shadow Demon");
  eq(L.makeDisp("SPECTRE", 2, 0), "SPectre");
  eq(L.makeDisp("QUEEN OF PAIN", 1, 0), "Queen of Pain");
  eq(L.makeDisp("ALCHEMIST", 1, 9), "ALchemist");
  eq(L.makeDisp("PHANTOM ASSASSIN", 0, 1), "Phantom Assassin");
  eq(L.makeDisp("WINTER WYVERN", 2, 2), "Winter Wyvern");
});

test("makeDisp produces exactly two uppercase letters", () => {
  for (const [n, name] of [[23,"SHADOW DEMON"],[1,"PHANTOM ASSASSIN"],[55,"BRISTLE BACK"]]) {
    const [t, o] = L.digitsOf(n);
    const ups = L.highlightedLetters(L.makeDisp(name, t, o));
    eq(ups.length, 2, `${name} -> ${ups.length} uppercase`);
  }
});

test("makeDisp is idempotent", () => {
  const once = L.makeDisp("SHADOW DEMON", 2, 3);
  eq(L.makeDisp(once, 2, 3), once);
});

// -------------------------------------------------- THE BIG INVARIANT
// For every named hero, the highlighted (uppercase) letters, read left->right,
// must spell out the hero's number via the keyboard-column mapping.
test("every hero's highlighted letters encode its number", () => {
  for (const id of Object.keys(heroes).map(Number)) {
    const name = heroes[id];
    const ups = L.highlightedLetters(name);
    eq(ups.length, 2, `#${id} "${name}" has ${ups.length} highlights (want 2)`);
    const [tens, ones] = L.digitsOf(id);
    eq(L.COL[ups[0].ch.toLowerCase()], tens, `#${id} "${name}" tens letter`);
    eq(L.COL[ups[1].ch.toLowerCase()], ones, `#${id} "${name}" ones letter`);
  }
});

test("multi-word heroes highlight two WORD-START letters (not mid-word)", () => {
  const raw = {};
  for (const line of csvText.split(/\r?\n/)) {
    const m = line.match(/^(\d+),"[^"]*",([^,]*),/);
    if (m && m[2].trim()) raw[+m[1]] = m[2].trim();
  }
  for (const id of Object.keys(heroes).map(Number)) {
    const name = heroes[id];
    const ws = new Set(L.wordStarts(name));
    const wordCount = name.trim().split(/\s+/).length;
    if (wordCount < 2) continue;                 // single word -> sequential allowed
    const ups = L.highlightedLetters(name);
    // both highlights must sit at word starts, and in two different words
    assert.ok(ws.has(ups[0].i), `#${id} "${name}" 1st highlight not a word start`);
    assert.ok(ws.has(ups[1].i), `#${id} "${name}" 2nd highlight not a word start`);
  }
});

test("makeDisp prefers word starts over sequential (Drow Ranger, not dRow)", () => {
  eq(L.makeDisp("DROW RANGER", 3, 4), "Drow Ranger");
  eq(L.makeDisp("WIND RANGER", 2, 4), "Wind Ranger");
  eq(L.makeDisp("DARK SEER",   3, 2), "Dark Seer");
  eq(L.makeDisp("ZEUS",        1, 3), "ZEus");        // single word -> sequential
});

test("makeDisp skips connector words (of/the/a/and)", () => {
  eq(L.makeDisp("Goddess of Luck", 5, 9), "Goddess of Luck");   // G,L not G,O(of)
  eq(L.makeDisp("QUEEN OF PAIN",   1, 0), "Queen of Pain");     // Q,P
  eq(L.makeDisp("Princess of the Moon", 0, 7), "Princess of the Moon"); // P,M
});

test("highlighted letters keep name order (i0 < i1)", () => {
  for (const id of Object.keys(heroes).map(Number)) {
    const ups = L.highlightedLetters(heroes[id]);
    assert.ok(ups[0].i < ups[1].i, `#${id} order`);
  }
});

// ---------------------------------------------------------------- compute()
test("compute(23) shades columns 2 & 3, lights S and D", () => {
  const r = L.compute(23, heroes);
  assert.ok(r.valid);
  eq(r.tens, 2); eq(r.ones, 3);
  eq(r.name, "Shadow Demon");
  deep([...r.exactKeys].sort(), ["d", "s"]);
  // column keys = every letter in column 2 or 3
  deep([...r.colKeys].sort(), ["c","d","e","s","w","x"].sort());
});

test("compute(1) lights P and A (tens digit 0)", () => {
  const r = L.compute(1, heroes);
  eq(r.tens, 0); eq(r.ones, 1);
  deep([...r.exactKeys].sort(), ["a", "p"]);
  assert.ok(r.colKeys.has("p"));            // column 0
  for (const ch of "qaz") assert.ok(r.colKeys.has(ch)); // column 1
});

test("compute on empty-name number is valid but nameless", () => {
  const r = L.compute(40, heroes);
  assert.ok(r.valid);
  eq(r.name, "");
  eq(r.exactKeys.size, 0);
});

test("compute on invalid number returns {valid:false}", () => {
  for (const bad of [0, 100, NaN, -3])
    eq(L.compute(bad, heroes).valid, false);
});

test("exact keys are always a subset of the shaded columns", () => {
  for (const id of Object.keys(heroes).map(Number)) {
    const r = L.compute(id, heroes);
    for (const k of r.exactKeys)
      assert.ok(r.colKeys.has(k), `#${id} exact ${k} not in columns`);
  }
});

// ---------------------------------------------------------------- build round-trip
test("build.rebuild is stable on current data.csv", () => {
  const { rebuild } = require("./build");
  eq(rebuild(csvText), csvText.replace(/\n$/, ""));
});

// ---------------------------------------------------------------- summary
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
