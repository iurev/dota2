// DOM glue only. All logic lives in logic.js (loaded first; globals: COL, ROWS,
// parseCsv, compute, ...).

let heroes = {};

// ---- build keyboard as an aligned grid (each digit = one column) ----
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];   // column order, left -> right
const colOf = d => DIGITS.indexOf(d) + 1;        // grid column for a digit
const kb = document.getElementById("kb");
const keyEls = {};  // letter -> element
const headEls = {}; // digit  -> header cell

// header row: the digits (part of the keyboard, highlightable)
for (const d of DIGITS) {
  const h = document.createElement("div");
  h.className = "kb-head";
  h.dataset.digit = d;
  h.style.gridColumn = colOf(d);
  h.style.gridRow = 1;
  h.textContent = d;
  kb.appendChild(h);
  headEls[d] = h;
}

// letter rows (top/home/bottom -> grid rows 2/3/4), placed under their digit
["top", "home", "bottom"].forEach((row, ri) => {
  for (const ch of ROWS[row]) {
    const k = document.createElement("div");
    k.className = "key";
    k.dataset.letter = ch;
    k.style.gridColumn = colOf(COL[ch]);
    k.style.gridRow = ri + 2;
    k.innerHTML = ch;
    kb.appendChild(k);
    keyEls[ch] = k;
  }
});

// ---- elements ----
const numEl = document.getElementById("num");
const statusEl = document.getElementById("status");
const heroBox = document.getElementById("heroBox");
const heroImg = document.getElementById("heroImg");
heroImg.onerror = () => heroBox.classList.add("noimg");      // fall back to "?"
heroImg.onload  = () => heroBox.classList.remove("noimg");

// ---- load data.csv ----
fetch("./data.csv")
  .then(r => r.text())
  .then(text => {
    heroes = parseCsv(text);
    statusEl.textContent = `${Object.keys(heroes).length} heroes loaded`;
    update();
  })
  .catch(() => { statusEl.textContent = "failed to load data.csv — serve over http"; });

// ---- render ----
// renders the name; returns the highlighted (UPPERCASE) letter spans, in order
function renderHero(name) {
  const wrap = document.getElementById("heroName");
  if (!name) {
    wrap.className = "hero-name empty";
    wrap.textContent = "— no hero for this number —";
    return [];
  }
  wrap.className = "hero-name";
  wrap.innerHTML = "";
  const used = [];
  for (const ch of name) {
    const el = document.createElement("span");
    const isSpace = !/\S/.test(ch);
    const isLetter = /[a-z]/i.test(ch);
    el.className = "ch" + (isSpace ? " space" : " letter");
    if (isLetter) el.dataset.letter = ch.toLowerCase();
    if (isLetter && ch === ch.toUpperCase()) { el.classList.add("used"); used.push(el); }
    el.textContent = ch;
    wrap.appendChild(el);
  }
  return used;
}

// ---- curved connector arrows from each exact key to its name letter ----
const SVGNS = "http://www.w3.org/2000/svg";
const wiresSvg = document.getElementById("wires");
const WIRE_COLORS = ["#ff5a5f", "#1f8cff", "#22b07a", "#f5a623"]; // vivid, distinct
let lastUsed = [];

function clearWires() {
  if (wiresSvg && wiresSvg.querySelectorAll)
    wiresSvg.querySelectorAll("g.wire").forEach(g => g.remove());
}

function drawWires(used) {
  lastUsed = used || [];
  if (!wiresSvg || typeof document.createElementNS !== "function") return; // no-op in tests
  clearWires();
  lastUsed.forEach((nameEl, i) => {
    const keyEl = keyEls[nameEl.dataset.letter];
    if (!keyEl || typeof keyEl.getBoundingClientRect !== "function") return;
    const a = keyEl.getBoundingClientRect();
    const b = nameEl.getBoundingClientRect();
    const x0 = a.left + a.width / 2, y0 = a.top;       // leave from top of the key
    const x1 = b.left + b.width / 2, y1 = b.bottom;    // arrive at bottom of the letter
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;               // perpendicular -> the "bend"
    const bow = (i % 2 ? -1 : 1) * Math.min(90, len * 0.28);
    const cx = (x0 + x1) / 2 + px * bow, cy = (y0 + y1) / 2 + py * bow;
    const d = `M ${x0} ${y0} Q ${cx} ${cy} ${x1} ${y1}`;
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "wire");

    const hit = document.createElementNS(SVGNS, "path");   // fat invisible hover target
    hit.setAttribute("d", d);
    hit.setAttribute("class", "hit");

    const vis = document.createElementNS(SVGNS, "path");   // visible colored arrow
    vis.setAttribute("d", d);
    vis.setAttribute("class", "vis");
    vis.setAttribute("stroke", WIRE_COLORS[i % WIRE_COLORS.length]);
    vis.setAttribute("marker-end", "url(#arrowhead)");

    g.appendChild(hit);
    g.appendChild(vis);
    wiresSvg.appendChild(g);
  });
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("resize", () => drawWires(lastUsed));
  window.addEventListener("scroll", () => drawWires(lastUsed), true);
}

function update() {
  for (const k of Object.values(keyEls)) k.className = "key";
  for (const h of Object.values(headEls)) h.className = "kb-head";

  const r = compute(parseInt(numEl.value, 10), heroes);

  if (!r.valid) {
    heroBox.classList.add("noimg"); heroImg.removeAttribute("src");
    renderHero(null);
    drawWires([]);
    return;
  }

  // light the two active digit cells (part of the keyboard), color-paired
  headEls[r.tens].classList.add("lit"); headEls[r.tens].classList.add("hl0");
  headEls[r.ones].classList.add("lit"); headEls[r.ones].classList.add("hl1");

  for (const [ch, el] of Object.entries(keyEls)) {
    if (r.colKeys.has(ch)) el.classList.add("col");
    if (r.exactKeys.has(ch)) el.classList.add("exact");
  }

  // avatar: load img/<n>.png; onerror -> "?" placeholder (slot stays, layout fixed)
  const n = parseInt(numEl.value, 10);
  if (r.name) heroImg.src = `img/${n}.png`;
  else { heroBox.classList.add("noimg"); heroImg.removeAttribute("src"); }

  // pair each highlighted letter + its keyboard key with arrow color hl0/hl1
  const used = renderHero(r.name);
  used.forEach((span, i) => {
    const cls = "hl" + i;
    span.classList.add(cls);
    const key = keyEls[span.dataset.letter];
    if (key) key.classList.add(cls);
  });
  drawWires(used);
}

numEl.addEventListener("input", update);
