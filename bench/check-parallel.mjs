// Independently checks a run saved by `bench/parallel.js --save <file>`.
//
// Replays every scramble-and-solution pair through cubing.js, which shares no
// code with this solver, confirms the cube ends solved, and recounts the moves
// from the solution strings rather than trusting the solver's own numbers.
//
//   npm install && node bench/check-parallel.mjs results/<file>.tsv

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { puzzles } from "cubing/puzzles";

const HERE = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("usage: node bench/check-parallel.mjs <saved run .tsv>");
  process.exit(2);
}

const scrambles = readFileSync(join(HERE, "..", "results", "scrambles-2000.txt"), "utf8").replace(/\n+$/, "").split(/\r?\n/);
const rows = readFileSync(file, "utf8").replace(/\n+$/, "").split(/\r?\n/).slice(1).map((l) => {
  const [config, idx, moves, ms, solution] = l.split("\t");
  return { config, idx: Number(idx), moves: Number(moves), ms: Number(ms), solution };
});

const kpuzzle = await puzzles["4x4x4"].kpuzzle();
// The 24 solved-but-rotated patterns. A 4x4x4 has no fixed centres, so a cube
// solved in a rotated orientation is genuinely solved.
const solvedClass = [];
{
  const seen = new Set();
  const queue = [kpuzzle.defaultPattern()];
  while (queue.length) {
    const p = queue.shift();
    const key = JSON.stringify(p.patternData);
    if (seen.has(key)) continue;
    seen.add(key);
    solvedClass.push(p);
    for (const g of ["x", "y"]) queue.push(p.applyAlg(g));
  }
}
const isSolved = (p) => solvedClass.some((q) => p.isIdentical(q));

const VOCAB = new Set();
for (const f of ["U", "R", "F", "D", "L", "B"]) {
  for (const w of ["", "w"]) for (const a of ["", "2", "'"]) VOCAB.add(f + w + a);
}
const tokens = (s) => (s.trim() === "" ? [] : s.trim().split(/\s+/));

const by = new Map();
let unsolved = 0, badVocab = 0, miscount = 0;
for (const r of rows) {
  const toks = tokens(r.solution);
  if (toks.some((t) => !VOCAB.has(t))) badVocab++;
  if (toks.length !== r.moves) miscount++;
  const end = kpuzzle.defaultPattern().applyAlg(scrambles[r.idx]).applyAlg(r.solution);
  if (!isSolved(end)) {
    unsolved++;
    console.log("NOT SOLVED: %s scramble %d", r.config, r.idx);
  }
  if (!by.has(r.config)) by.set(r.config, []);
  by.get(r.config).push({ moves: toks.length, ms: r.ms });
}

console.log("solved-orientation class: %d patterns (expect 24)", solvedClass.length);
console.log("%d solutions checked with cubing.js: %d not solved, %d outside the OBTM alphabet, %d with a wrong move count\n",
  rows.length, unsolved, badVocab, miscount);
for (const [config, list] of by) {
  const mv = list.map((x) => x.moves), ms = list.map((x) => x.ms).sort((a, b) => a - b);
  const mean = mv.reduce((a, b) => a + b, 0) / mv.length;
  console.log("%s  n=%d  recounted average %s moves  time mean %d ms, max %d ms",
    config.padEnd(22), mv.length, mean.toFixed(3), Math.round(ms.reduce((a, b) => a + b, 0) / ms.length), ms[ms.length - 1]);
}
process.exit(unsolved + badVocab + miscount === 0 ? 0 : 1);
