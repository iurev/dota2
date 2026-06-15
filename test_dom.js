// DOM smoke test: runs the real app.js against a tiny fake DOM + fake fetch,
// then asserts the UI state. Run: node test_dom.js
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const dir = __dirname;
const csv = fs.readFileSync(path.join(dir, "data.csv"), "utf8");

// ---- tiny fake DOM ----
function mkEl() {
  const set = new Set();
  const el = {
    className: "", dataset: {}, style: {}, value: "",
    _children: [], textContent: "",
    classList: {
      add: c => set.add(c),
      remove: c => set.delete(c),
      contains: c => set.has(c),
      _set: set,
    },
    _handlers: {},
    appendChild(c) { this._children.push(c); return c; },
    addEventListener(ev, fn) { this._handlers[ev] = fn; },
    removeAttribute(a) { delete this[a]; },
  };
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get() { return html; },
    set(v) { html = v; if (v === "") el._children.length = 0; }, // mirror real clear
  });
  return el;
}
// keep className in sync with classList when app.js resets to "key"
function wrapClassName(el) {
  Object.defineProperty(el, "className", {
    get() { return el._cn || ""; },
    set(v) { el._cn = v; el.classList._set.clear(); v.split(/\s+/).filter(Boolean).forEach(c => el.classList._set.add(c)); },
  });
}

const byId = { kb: mkEl(), num: mkEl(), dTens: mkEl(), dOnes: mkEl(), status: mkEl(), heroName: mkEl(), heroBox: mkEl(), heroImg: mkEl() };

const document = {
  querySelector: () => null,
  getElementById: id => byId[id],
  createElement() { const el = mkEl(); wrapClassName(el); return el; },
};

let resolveFetch;
const fetch = () => Promise.resolve({ text: () => Promise.resolve(csv) });

// ---- run logic.js + app.js in one scope ----
const code = fs.readFileSync(path.join(dir, "logic.js"), "utf8") + "\n" +
             fs.readFileSync(path.join(dir, "app.js"), "utf8");
const sandbox = { document, fetch, console, window: undefined, module: undefined };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// ---- helpers ----
const allKeys = () => byId.kb._children.filter(c => c.dataset.letter);
const headCells = () => byId.kb._children.filter(c => c.dataset.digit !== undefined);
const keyByLetter = ch => allKeys().find(k => k.dataset.letter === ch);
const headByDigit = d => headCells().find(c => Number(c.dataset.digit) === d);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error("FAIL:", name, "\n      ", e.message); }
}

(async () => {
  // wait for fetch().then() chain to settle
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setTimeout(r, 0));

  test("keyboard rendered: 26 keys + 10 digit headers, aligned by column", () => {
    assert.strictEqual(allKeys().length, 26);
    assert.strictEqual(headCells().length, 10);
    // q/a/z share a grid column (digit 1); w/s/x share the next; p sits in last
    assert.strictEqual(keyByLetter("q").style.gridColumn, keyByLetter("a").style.gridColumn);
    assert.strictEqual(keyByLetter("a").style.gridColumn, keyByLetter("z").style.gridColumn);
    assert.strictEqual(keyByLetter("p").style.gridColumn, 10);
    // different digits -> different columns
    assert.notStrictEqual(keyByLetter("q").style.gridColumn, keyByLetter("w").style.gridColumn);
  });

  test("status shows hero count after load", () => {
    assert.ok(/\d+ heroes loaded/.test(byId.status.textContent), byId.status.textContent);
  });

  // simulate typing 23
  function type(v) {
    byId.num.value = v;
    byId.num._handlers.input();
  }

  test("typing 23 -> Shadow Demon, keys S & D exact, columns shaded, digits 2&3 lit", () => {
    type("23");
    assert.ok(headByDigit(2).classList.contains("lit"), "digit 2 lit");
    assert.ok(headByDigit(3).classList.contains("lit"), "digit 3 lit");
    assert.ok(!headByDigit(5).classList.contains("lit"), "digit 5 not lit");
    assert.ok(keyByLetter("s").classList.contains("exact"), "s exact");
    assert.ok(keyByLetter("d").classList.contains("exact"), "d exact");
    assert.ok(keyByLetter("w").classList.contains("col"), "w col2 shaded");
    assert.ok(keyByLetter("e").classList.contains("col"), "e col3 shaded");
    assert.ok(!keyByLetter("p").classList.contains("col"), "p not shaded");
    // hero name: exactly 2 chars marked used, and they are S, D
    const used = byId.heroName._children.filter(c => c.classList.contains("used"));
    assert.strictEqual(used.length, 2);
    assert.deepStrictEqual(used.map(c => c.textContent.toLowerCase()).sort(), ["d", "s"]);
  });

  test("highlighted name letters carry dataset.letter for wire pairing", () => {
    type("23");
    const used = byId.heroName._children.filter(c => c.classList.contains("used"));
    assert.deepStrictEqual(used.map(c => c.dataset.letter).sort(), ["d", "s"]);
    // each used letter maps to a real keyboard key (the wire source)
    for (const c of used) assert.ok(keyByLetter(c.dataset.letter), `key for ${c.dataset.letter}`);
  });

  test("avatar src points to img/<n>.png for a hero", () => {
    type("23");
    assert.strictEqual(byId.heroImg.src, "img/23.png");
  });

  test("typing 1 -> Phantom Assassin, P & A exact", () => {
    type("1");
    assert.ok(keyByLetter("p").classList.contains("exact"), "p exact");
    assert.ok(keyByLetter("a").classList.contains("exact"), "a exact");
    // previous exacts cleared
    assert.ok(!keyByLetter("d").classList.contains("exact"), "d cleared");
  });

  test("empty-name number 40 -> nameless, no exact keys, box shows '?' (never hidden)", () => {
    type("40");
    assert.ok(/no hero/.test(byId.heroName.textContent));
    assert.ok(!allKeys().some(k => k.classList.contains("exact")), "no exact keys");
    assert.ok(byId.heroBox.classList.contains("noimg"), "box in placeholder state");
    assert.notStrictEqual(byId.heroBox.hidden, true, "box never hidden");
    assert.ok(!byId.heroImg.src, "no avatar src");
  });

  test("invalid input clears everything", () => {
    type("999");
    assert.ok(!headCells().some(h => h.classList.contains("lit")), "no digit lit");
    assert.ok(!allKeys().some(k => k.classList.contains("col")), "no columns shaded");
  });

  test("empty input clears", () => {
    type("");
    assert.ok(!headCells().some(h => h.classList.contains("lit")), "no digit lit");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
