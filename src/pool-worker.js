// One solver instance per thread. Receives arms from src/pool.js, solves each
// within its budget and returns a solution that has already been verified
// against the original state.
"use strict";

const { parentPort, workerData } = require("worker_threads");
const { createEngine } = require("./engine");

// workerData.edge3 is the full-depth edge table the pool built or loaded;
// every thread reads the same memory. Without it the engine builds upstream's
// shallower table for itself.
const e3 = workerData && workerData.edge3;
const env = createEngine({ edge3: e3 ? { maxPrun: e3.maxPrun, table: new Int32Array(e3.buffer) } : null });
const S = env.scramble_444;
const t0 = Date.now();
S.init();
const DEFAULT_P2 = (workerData && workerData.phase2Sols) || 300;
S.setConfig({ phase2Sols: DEFAULT_P2 });
env.min2phase.initFull();
const PERMS = S.facePerms();
parentPort.postMessage({ type: "ready", ms: Date.now() - t0 });

// Merges adjacent turns of the same layer set, so a prefix move that lands
// next to a matching first move of the solution costs nothing or cancels.
const POW = { "": 1, "2": 2, "'": 3 };
const SUF = ["", "", "2", "'"];
function simplify(seq) {
  const out = [];
  for (const tok of seq.trim().split(/\s+/).filter(Boolean)) {
    const base = tok.replace(/[2']$/, "");
    const p = POW[tok.slice(base.length)];
    const top = out[out.length - 1];
    if (top && top.base === base) {
      top.p = (top.p + p) % 4;
      if (top.p === 0) out.pop();
    } else {
      out.push({ base, p });
    }
  }
  return out.map((t) => t.base + SUF[t.p]).join(" ");
}

function count(seq) {
  return seq.trim() === "" ? 0 : seq.trim().split(/\s+/).length;
}

// An arm is a whole-cube rotation, optionally followed by one prefix move.
// Rotating changes which way the search frames the cube, and adds no moves:
// a solution for the rotated cube solves the original once its faces are
// relabelled. A prefix move m adds at most one move: "m S" solves X when S
// solves X·m.
//
// A shard arm instead takes one slice of a single search: candidates
// i % shards == shard, pruning against the incumbent the other shards
// publish through the shared buffer.
function runArm({ state, rot, prefix, shard, shards, shared, budgetMs, options }) {
  const t = Date.now();
  const armState = S.applyMoves(state, ((rot || "") + " " + (prefix || "")).trim());
  const extra = { budgetMs };
  if (shared) Object.assign(extra, { shard, shards, sharedBest: new Int32Array(shared) });
  // phase2Sols sizes the reduction-prefix pool every arm rebuilds before it
  // can screen anything, so short budgets want a smaller one.
  const p2 = options && options.phase2Sols;
  if (p2) S.setConfig({ phase2Sols: p2 });
  let res;
  try {
    res = S.solve(armState, Object.assign({}, options, extra));
  } finally {
    if (p2) S.setConfig({ phase2Sols: DEFAULT_P2 });
  }
  if (res.error) return { error: res.error, ms: Date.now() - t };
  const raw = simplify(((prefix || "") + " " + res.solution).trim());
  let solution = null;
  let oriented = false;
  for (const perm of PERMS) {
    const s = S.rotateSequence(raw, perm);
    const v = S.verify(state, s);
    if (v.ok && (solution === null || v.oriented)) {
      solution = s;
      oriented = v.oriented;
      if (oriented) break;
    }
  }
  if (solution === null) return { error: "arm solution failed verification", ms: Date.now() - t };
  return {
    solution,
    moves: count(solution),
    oriented,
    reductionMoves: res.reductionMoves,
    p333: res.phases && res.phases.p333,
    reductions: res.stats && res.stats.reductions,
    ms: Date.now() - t
  };
}

parentPort.on("message", (msg) => {
  let out;
  try {
    if (msg.type === "arm") out = runArm(msg);
    else if (msg.type === "baseline") {
      S.setConfig({ phase2Sols: 100 });
      const b = S.solveStateBaseline(msg.state);
      S.setConfig({ phase2Sols: DEFAULT_P2 });
      out = b.error ? { error: b.error } : { solution: b.solution, moves: b.moves, verified: S.verify(msg.state, b.solution).ok };
    } else if (msg.type === "scramble") {
      const scramble = msg.scramble || S.getRandomScramble().trim();
      out = { scramble, state: S.scrambleToState(scramble) };
    } else if (msg.type === "random") {
      out = { state: S.randomState() };
    } else out = { error: "unknown message type: " + msg.type };
  } catch (err) {
    out = { error: String((err && err.stack) || err) };
  }
  parentPort.postMessage({ type: "done", id: msg.id, result: out });
});
