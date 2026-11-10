// Loads the vendored csTimer sources plus our fork as one function body in
// the main V8 context. They are plain browser scripts that talk to each other
// through top-level `var`s, so wrapping their concatenation in a function
// turns those globals into closure variables and the same files serve both
// Node and the web build unchanged.
//
// An earlier version ran them in a `vm.createContext` sandbox. Every global
// lookup there goes through the context's interceptors, and the solver's hot
// loops touch `mathlib`, `min2phase` and friends constantly: table init took
// 10.6 s against 1.85 s here, and four calibration solves 9.8 s against 1.4 s,
// with identical move counts. That sandbox is why Node used to look about five
// times slower than the browser.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");

const BASE = [
  ["vendor", "shim.js"],
  ["vendor", "isaac.js"],
  ["vendor", "mathlib.js"],
  ["vendor", "min2phase.js"]
];

// `pristine` loads the untouched csTimer solver instead of our fork, so the
// two can be timed against each other in the same process.
function scriptsFor(pristine) {
  return BASE.concat([pristine ? ["vendor", "scramble_444.js"] : ["src", "tpr444.js"]]);
}

const compiled = new Map();

function compile(pristine) {
  if (compiled.has(pristine)) return compiled.get(pristine);
  const body = scriptsFor(pristine)
    .map((parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8"))
    // Each browser script has its own "use strict" prologue. Inside one
    // function body only the first would count, and as directives in the
    // middle they are inert anyway; the sources run in sloppy mode in csTimer.
    .map((src) => src.replace(/^\s*"use strict";/m, ""))
    .join("\n;\n");
  // `crypto` is passed in because mathlib seeds ISAAC from
  // crypto.getRandomValues when it exists and silently falls back to the
  // millisecond clock when it does not. `setDebug` reaches shim.js's DEBUG.
  const factory = vm.runInThisContext(
    "(function (crypto) {\n" + body +
    "\n;return { scramble_444: scramble_444, min2phase: min2phase, mathlib: mathlib, isaac: isaac," +
    " setDebug: function (v) { DEBUG = !!v; } };\n})",
    { filename: path.join(ROOT, pristine ? "bundle-pristine.js" : "bundle.js") }
  );
  compiled.set(pristine, factory);
  return factory;
}

// Each call returns an independent solver instance with its own tables.
// `edge3` is passed to the fork's configureEdge3 before anything initialises:
// { maxPrun } to build a deeper phase-3 edge table, or { maxPrun, table } to
// adopt one that is already built (see sharedEdge3).
function createEngine({ debug = false, pristine = false, edge3 = null } = {}) {
  const env = compile(pristine)(require("crypto").webcrypto);
  if (debug) env.setDebug(true);
  if (edge3 && !pristine) env.scramble_444.configureEdge3(edge3);
  return env;
}

// The full-depth phase-3 edge table: 31,006,080 two-bit entries, 7.4 MB.
// Upstream stops it at depth 9 to start quickly, which leaves 91% of it
// unknown; finishing it takes about 20 s, so it is built once, kept in
// .cache/, and handed to every thread as one SharedArrayBuffer.
const EDGE3_WORDS = 1937880;
const EDGE3_FULL = 14;
let edge3Shared = null;

function checksum(words) {
  let sum = 0;
  for (let i = 0; i < words.length; i++) sum = (sum + words[i]) | 0;
  return sum;
}

// Returns { maxPrun, buffer, source, ms }. The cache file is the raw words
// (platform byte order, little-endian everywhere Node runs today) followed by
// their 32-bit sum; a file that fails the check is rebuilt, never trusted.
function sharedEdge3({ cacheDir = path.join(ROOT, ".cache"), log = () => {} } = {}) {
  if (edge3Shared) return edge3Shared;
  const t0 = Date.now();
  const file = path.join(cacheDir, `edge3-prun-d${EDGE3_FULL}.bin`);
  const buffer = new SharedArrayBuffer(EDGE3_WORDS * 4);
  const words = new Int32Array(buffer);
  let source = "built";
  try {
    const raw = fs.readFileSync(file);
    if (raw.length === EDGE3_WORDS * 4 + 4) {
      new Uint8Array(buffer).set(raw.subarray(0, EDGE3_WORDS * 4));
      if (checksum(words) === raw.readInt32LE(EDGE3_WORDS * 4)) source = "cache";
    }
  } catch (err) {
    if (err.code !== "ENOENT") log(`edge table cache unreadable (${err.code}), rebuilding`);
  }
  if (source !== "cache") {
    log("building the full-depth edge table (about 20 s, first run only)...");
    // init() fills `buffer` and throws if any depth's entry count is wrong.
    createEngine({ edge3: { maxPrun: EDGE3_FULL, buffer } }).scramble_444.init();
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const tail = Buffer.alloc(4);
      tail.writeInt32LE(checksum(words));
      const tmp = file + "." + process.pid + ".tmp";
      fs.writeFileSync(tmp, Buffer.concat([Buffer.from(buffer), tail]));
      fs.renameSync(tmp, file);
    } catch (err) {
      log(`could not save the edge table cache (${err.code || err.message}); it will be rebuilt next run`);
    }
  }
  edge3Shared = { maxPrun: EDGE3_FULL, buffer, source, ms: Date.now() - t0 };
  return edge3Shared;
}

module.exports = { createEngine, sharedEdge3, ROOT };
