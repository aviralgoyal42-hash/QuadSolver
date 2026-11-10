// Benchmarks multi-threaded configurations on the saved 2000-scramble set,
// paired against the saved results for the same scrambles: the stock solver
// and the single-core 5 s run that averaged 42.458 (results/results-2000.csv).
//
//   node bench/parallel.js [--from 0] [--count 120] [--configs 1:0:stock,12:300,12:1500]
//                          [--timing average|hard] [--save results/run.tsv]
//                          [--poolTotal n] [--options '{"json":"for the solver"}']
//
// A config is threads:budgetMs[:mode]. Mode is shard (the default, one search
// split across the threads), rotate (one whole search per thread) or stock
// (the unmodified solver on one thread, which has no budget). Time is solving
// time only: tables are built and a few warm-up solves run before the clock
// starts. Every solution is verified inside the worker and again here by a
// separate engine instance; --save writes them all out so that
// bench/check-parallel.mjs can replay them through cubing.js.
"use strict";

const fs = require("fs");
const path = require("path");
const { SolverPool } = require("../src/pool");
const { createEngine } = require("../src/engine");

const args = { from: 0, count: 120, configs: "12:1000,12:2000" };
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const from = Number(args.from);
const count = Number(args.count);
// threads:budgetMs[:mode[:groups]], where groups splits shard mode across
// that many rotations. --options is a JSON object passed to the solver.
const options = args.options ? JSON.parse(args.options) : {};
const configs = args.configs.split(",").map((c) => {
  const [threads, budgetMs, mode, groups] = c.split(":");
  return { threads: Number(threads), budgetMs: Number(budgetMs), mode: mode || "shard", groups: Number(groups || 1) };
});

const RES = path.join(__dirname, "..", "results");
const allScrambles = fs.readFileSync(path.join(RES, "scrambles-2000.txt"), "utf8").trim().split(/\r?\n/);
const scrambles = allScrambles.slice(from, from + count);
const saved = fs.readFileSync(path.join(RES, "results-2000.csv"), "utf8").trim().split(/\r?\n/).slice(1)
  .map((l) => l.split(",")).slice(from, from + count);
const stock = saved.map((r) => Number(r[2]));
const single5s = saved.map((r) => Number(r[3]));

const S = createEngine().scramble_444;
S.init();
const states = scrambles.map((s) => S.scrambleToState(s));
const warmStates = allScrambles.slice(1990, 1996).map((s) => S.scrambleToState(s));

const sum = (a) => a.reduce((p, c) => p + c, 0);
const avg = (a) => sum(a) / a.length;
const sd = (a) => { const m = avg(a); return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length - 1)); };
const ci = (a) => { const h = 1.96 * sd(a) / Math.sqrt(a.length); return `[${(avg(a) - h).toFixed(3)}, ${(avg(a) + h).toFixed(3)}]`; };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function paired(moves, ref) {
  const d = moves.map((m, i) => ref[i] - m);
  return `${avg(d) >= 0 ? "+" : ""}${avg(d).toFixed(3)} ${ci(d)}, shorter ${d.filter((x) => x > 0).length} longer ${d.filter((x) => x < 0).length}`;
}

(async () => {
  const savedRows = [];
  const pools = new Map();
  const summary = [];
  for (const cfg of configs) {
    // The stock baseline runs on upstream's own edge table, not the deeper
    // one, so it is the unmodified search in every respect.
    const key = cfg.threads + (cfg.mode === "stock" ? ":stock" : "");
    if (!pools.has(key)) {
      const p = new SolverPool({ threads: cfg.threads, deepEdge: cfg.mode !== "stock" && args.deepEdge !== "0" });
      await p.ready;
      pools.set(key, p);
    }
    const pool = pools.get(key);
    // Untimed warm-up on scrambles outside every benchmark range, so the
    // first timed solves do not pay for cold JIT code in each thread.
    for (const w of warmStates) {
      if (cfg.mode === "stock") await Promise.all(Array.from({ length: cfg.threads }, () => pool.baseline(w)));
      else await pool.solve(w, { budgetMs: Math.min(cfg.budgetMs, 600), mode: cfg.mode, groups: cfg.groups, options });
    }
    const moves = [];
    const times = [];
    let fails = 0;
    const label = cfg.threads + ":" + cfg.budgetMs + ":" + cfg.mode + (cfg.groups > 1 ? "x" + cfg.groups : "");
    for (let i = 0; i < states.length; i++) {
      // mode "stock" times csTimer's unmodified search (TPR's parameters) on
      // one thread; it has no budget, so budgetMs is ignored.
      let r;
      if (cfg.mode === "stock") {
        const t = Date.now();
        r = await pool.baseline(states[i]);
        r.ms = Date.now() - t;
      } else {
        r = await pool.solve(states[i], { budgetMs: cfg.budgetMs, mode: cfg.mode, groups: cfg.groups, poolTotal: args.poolTotal ? Number(args.poolTotal) : undefined, timing: args.timing || "average", options });
      }
      if (r.error || !S.verify(states[i], r.solution).ok) {
        console.error(`${cfg.threads}:${cfg.budgetMs}:${cfg.mode} #${from + i} FAILED: ${r.error || "bad solution"}`);
        fails++;
        moves.push(stock[i]); // count a failure as no better than stock
        times.push(r.ms || 0);
        continue;
      }
      moves.push(r.moves);
      times.push(r.ms);
      savedRows.push([label, from + i, r.moves, r.ms, r.solution].join("\t"));
      if ((i + 1) % 20 === 0) {
        process.stdout.write(`  ${cfg.threads}:${cfg.budgetMs}:${cfg.mode}  ${i + 1}/${states.length}  running avg ${avg(moves).toFixed(3)}\n`);
      }
    }
    const line =
      `${String(cfg.threads).padStart(2)} threads ${String(cfg.budgetMs).padStart(5)} ms ${(cfg.mode + (cfg.groups > 1 ? "x" + cfg.groups : "")).padEnd(8)}` +
      `  avg ${avg(moves).toFixed(3)} ${ci(moves)}` +
      `  time mean ${Math.round(avg(times))} p95 ${pct(times, 0.95)} max ${Math.max(...times)} ms` +
      (cfg.mode === "stock" ? "" : `, over budget ${times.filter((t) => t > cfg.budgetMs).length}, over +15% ${times.filter((t) => t > cfg.budgetMs * 1.15).length}`) +
      `\n      vs saved 1-core 5 s: ${paired(moves, single5s)}` +
      `\n      vs stock:            ${paired(moves, stock)}` +
      (fails ? `\n      FAILURES ${fails}` : "");
    summary.push(line);
    console.log(line);
  }
  for (const p of pools.values()) await p.close();
  // --save writes every solution, so bench/check-parallel.mjs can replay them
  // through cubing.js without re-running anything.
  if (args.save) {
    fs.writeFileSync(args.save, ["config", "scramble", "moves", "ms", "solution"].join("\t") + "\n" + savedRows.join("\n") + "\n");
    console.log("saved " + savedRows.length + " solutions to " + args.save);
  }

  console.log(`\n=== scrambles ${from}..${from + count - 1} (${count}), stock avg ${avg(stock).toFixed(3)}, saved 1-core 5 s avg ${avg(single5s).toFixed(3)} ===`);
  for (const l of summary) console.log(l);
  process.exit(summary.some((l) => l.includes("FAILURES")) ? 1 : 0);
})();
