#!/usr/bin/env node
// Command-line solver. Runs natively in Node on every core; no browser.
//
//   node bin/solve.js "R U Rw2 ..."            solve a scramble
//   node bin/solve.js --state <96 facelets>    solve a facelet state (URFDLB order)
//   node bin/solve.js --random                 solve a random WCA-style scramble
//   node bin/solve.js --stdin                  build tables once, then solve one
//                                              scramble or state per input line
//
// Options:
//   --budget <ms>    solving time per cube, tables excluded (default 1500)
//   --strict         make the budget a cap no solve may exceed, not an average
//   --threads <n>    worker threads (default: all logical cores)
//   --mode <m>       shard (split one search, default) or rotate
//   --json           print a JSON object instead of text
"use strict";

const readline = require("readline");
const { SolverPool } = require("../src/pool");

function parseArgs(argv) {
  const a = { budget: 1500, json: false, mode: "shard", rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--budget") a.budget = Number(argv[++i]);
    else if (k === "--threads") a.threads = Number(argv[++i]);
    else if (k === "--mode") a.mode = argv[++i];
    else if (k === "--state") a.state = argv[++i];
    else if (k === "--random") a.random = true;
    else if (k === "--stdin") a.stdin = true;
    else if (k === "--strict") a.strict = true;
    else if (k === "--json") a.json = true;
    else if (k === "-h" || k === "--help") a.help = true;
    else a.rest.push(k);
  }
  if (a.rest.length) a.scramble = a.rest.join(" ");
  return a;
}

const STATE_RE = /^[URFDLB]{96}$/;

// Turns one input (scramble, state or "random") into a state. Scramble
// parsing and state checks happen before the clock starts.
async function prepare(pool, input) {
  if (input.state) {
    if (!STATE_RE.test(input.state)) throw new Error("state must be 96 characters of URFDLB");
    return { scramble: null, state: input.state };
  }
  const r = await pool.scramble(input.random ? undefined : input.scramble);
  if (r.error) throw new Error(r.error.split("\n")[0]);
  return r;
}

async function solveOne(pool, args, input) {
  const { scramble, state } = await prepare(pool, input);
  const res = await pool.solve(state, { budgetMs: args.budget, mode: args.mode, timing: args.strict ? "hard" : "average" });
  if (res.error) throw new Error(res.error);
  if (args.json) {
    console.log(JSON.stringify({
      scramble: scramble || null, state, solution: res.solution, moves: res.moves,
      verified: true, oriented: res.oriented, solveMs: res.ms, threads: pool.threads, mode: args.mode
    }));
  } else {
    if (scramble) console.log("scramble: " + scramble);
    console.log("solution: " + res.solution);
    console.log(`moves:    ${res.moves} OBTM (verified${res.oriented ? "" : ", finishes rotated"})`);
    console.log(`solved in ${res.ms} ms on ${res.arms} threads (${args.mode})`);
  }
  return res;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.state && !args.scramble && !args.random && !args.stdin)) {
    console.log(require("fs").readFileSync(__filename, "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(args.help ? 0 : 2);
  }
  if (!Number.isFinite(args.budget) || args.budget < 200) throw new Error("--budget must be at least 200 ms");
  if (args.mode !== "shard" && args.mode !== "rotate") throw new Error("--mode must be shard or rotate");

  const log = args.json ? () => {} : (...m) => console.error(...m);
  // The first run on a machine builds the full-depth edge table (about 20 s)
  // and saves it under .cache/; later runs load it in a few milliseconds.
  const t0 = Date.now();
  const pool = new SolverPool({ threads: args.threads, log });
  log(`building tables on ${pool.threads} threads...`);
  await pool.ready;
  // A few throwaway solves, so the first real one does not run on cold code.
  await pool.warmUp();
  log(`ready in ${Date.now() - t0} ms (not counted); solving budget ${args.budget} ms per cube`);

  if (!args.stdin) {
    await solveOne(pool, args, args);
    await pool.close();
    return;
  }

  // One cube per line: a scramble, a 96-character state, or "random".
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  let n = 0, moves = 0, ms = 0, failed = 0;
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const input = STATE_RE.test(line) ? { state: line } : line === "random" ? { random: true } : { scramble: line };
    try {
      const res = await solveOne(pool, args, input);
      n++; moves += res.moves; ms += res.ms;
    } catch (err) {
      failed++;
      console.log("error: " + (err && err.message ? err.message : err));
    }
    if (!args.json) console.log("");
  }
  await pool.close();
  if (n && !args.json) log(`${n} solved, average ${(moves / n).toFixed(3)} moves, ${Math.round(ms / n)} ms per cube${failed ? `, ${failed} failed` : ""}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("error: " + (err && err.message ? err.message : err));
  process.exit(1);
});
