# Results

All move counts are OBTM: 36 generators, six outer faces and six 2-layer wide
turns, each plain, doubled or inverted. A wide turn counts as one move, a
180 degree turn counts as one, and there are no slice moves. This is the metric
TPR's own benchmark uses.

## Method

**Scrambles.** `results/scrambles-2000.txt` holds 2000 random states, each
written as a scramble that generates it. States are drawn uniformly from the
legal positions (uniform corner permutation and twist, wing permutation and
centre arrangement), excluding the 672 states WCA regulation 4b3 rules out:
solved, or one move from solved, in any of the 24 orientations.

**Baseline.** The stock three-phase solver, run through the unmodified csTimer
sources in `vendor/` with TPR's own parameters, including
`solution(facelet, 21, 1000000, 500, 0)` for the 3x3x3 stage. Its solution for
every scramble is saved in `results/baseline-solutions-2000.txt`, so every
comparison below is paired: the same scramble, both solvers.

**Tuning and testing are kept apart.** Settings were chosen on scrambles 0 to
245. The figures reported here come from ranges that were not looked at until
the code was final. Which range each figure uses is stated next to it.

**Verification.** Every solution is replayed by the solver's own move code
before it is returned. Separately, `bench/check-parallel.mjs` replays every
saved solution through cubing.js, which shares no code with this project, and
recounts the moves from the solution text.

**Machine.** Ryzen 5 PRO 230, 6 cores and 12 threads, Windows 11, Node 24, on
mains power. Solving four fixed scrambles with the stock solver takes 680 to
840 ms on this machine depending on how warm it is; on battery it takes about
1500 ms. The solver works to a time budget, so a slower machine searches less
and returns longer solutions.

**Timing.** Time is measured per solve, from handing the state to the thread
pool to receiving a verified solution. Building the lookup tables and a short
warm-up happen once at start-up and are not included. By default the budget is
an average: the search runs until just before it, and the slowest solves finish
a few percent after it. `--strict` makes it a cap instead.

## The six tiers

Twelve threads, default settings, average timing. Scrambles 300 to 929, split
so that the longer tiers stay affordable.

| tier | scrambles | n | average | 95% CI | stock, same scrambles | saved | 95% CI | shorter / longer than stock |
|---|---|---|---|---|---|---|---|---|
| 300 ms | 300–599 | 300 | 43.007 | [42.89, 43.12] | 44.377 | 1.370 | [1.23, 1.51] | 214 / 5 |
| 1 s | 300–599 | 300 | 42.203 | [42.10, 42.31] | 44.377 | 2.173 | [2.03, 2.31] | 273 / 0 |
| 1.5 s | 300–599 | 300 | 41.997 | [41.89, 42.10] | 44.377 | 2.380 | [2.24, 2.52] | 278 / 0 |
| 3 s | 600–749 | 150 | 41.613 | [41.47, 41.76] | 44.200 | 2.587 | [2.36, 2.81] | 139 / 0 |
| 5 s | 750–849 | 100 | 41.560 | [41.37, 41.75] | 44.130 | 2.570 | [2.32, 2.82] | 94 / 0 |
| 10 s | 850–929 | 80 | 41.400 | [41.18, 41.62] | 43.900 | 2.500 | [2.24, 2.76] | 75 / 0 |

| tier | mean time | 95th percentile | slowest | over +15% |
|---|---|---|---|---|
| stock, one thread | 131 ms | 311 ms | 673 ms | |
| 300 ms | 296 ms | 304 ms | 311 ms | 0 |
| 1 s | 994 ms | 1005 ms | 1018 ms | 0 |
| 1.5 s | 1492 ms | 1504 ms | 1516 ms | 0 |
| 3 s | 2993 ms | 3005 ms | 3008 ms | 0 |
| 5 s | 4991 ms | 5000 ms | 5005 ms | 0 |
| 10 s | 9990 ms | 10000 ms | 10005 ms | 0 |

All 2130 solutions from these runs and the strict-cap runs below were replayed
through cubing.js: none unsolved, none outside the move alphabet, none with a
miscounted length. The raw output and every solution are in
`results/tiers-*.txt` and `results/tiers-*.tsv`.

How to read it:

- **The scramble sets differ in difficulty.** The stock solver averages 44.38
  on one range and 43.90 on another. Compare tiers by moves saved, not by the
  raw average.
- **Nothing measurable is gained after 3 s.** The 3 s, 5 s and 10 s tiers save
  2.59, 2.57 and 2.50 moves, each with an interval of about ±0.25. They are
  the same within the noise. The three useful settings are 300 ms, 1 to 1.5 s
  and 3 s.
- **300 ms is better on average, not always.** On 5 of 300 scrambles its
  answer was a move longer than the stock solver's. From 1 s up that did not
  happen on any scramble.
- **The fixed-work timing** was 681 ms before these runs and 680 ms after, so
  the machine ran at one speed throughout.

## The budget as a hard cap

The same 300 scrambles (300 to 599) with `--strict`.

| tier | average | saved vs stock | mean time | slowest | over budget |
|---|---|---|---|---|---|
| 300 ms, strict | 43.117 | 1.260 | 244 ms | 275 ms | 0 of 300 |
| 300 ms, default | 43.007 | 1.370 | 296 ms | 311 ms | 33 of 300 |
| 1.5 s, strict | 42.033 | 2.343 | 1436 ms | 1458 ms | 0 of 300 |
| 1.5 s, default | 41.997 | 2.380 | 1492 ms | 1516 ms | 24 of 300 |

With `--strict` the threads stop 70 ms early and the pool answers 40 ms before
the budget with the best verified solution it holds. That costs search time, a
quarter of the budget at 300 ms, which is why it is not the default. Earlier in
development, with smaller margins, 1 solve in 1580 exceeded a strict budget, by
21 ms, when the whole process was held off the CPU. A desktop operating system
cannot rule that out.

## What the improvement is made of

All on 12 threads, tuning scrambles. Differences under about 0.1 are within
run-to-run variation: the same configuration measured three times at 300 ms on
240 scrambles gave 42.61, 42.79 and 42.85.

| step | 1 s | 1.5 s |
|---|---|---|
| one search split across threads, shared pool of 300 | 42.56 | 42.40 |
| + full-depth edge table, each thread builds its own share of the pool | 42.64 | 42.45 |
| + pool of 3600 | 42.21 | 42.04 |
| + average timing, faster phase 2, pool rule | 42.08 | 41.94 |

The third row is worth noticing. Those two changes made the search roughly 30%
faster and the average did not move. That matches an earlier measurement on one
core, where six times the search time (5 s to 30 s) was worth 0.36 moves. Search
speed has logarithmic returns here.

What moved the average was the pool: how many phase 1 and 2 results the search
starts from.

| pool, all threads together | 300 | 600 | 1200 | 2400 | 3600 | 7200 | 14400 |
|---|---|---|---|---|---|---|---|
| 1 s | 42.64 | 42.43 | 42.30 | 42.25 | 42.21 | 42.34 | |
| 1.5 s | 42.45 | | | | 42.04 | 41.99 | 42.29 |

A larger pool holds shorter reductions, which no amount of searching a smaller
pool can find. Past a point, building the pool eats the time needed to search
it. The pool size therefore follows the budget: `quotaFor` in `src/pool.js`.

Why the pool matters more than the 3x3x3 stage: on 410 reduced states taken
from real solves, how often a 3x3x3 solution of a given length turns up depends
mostly on the state, not on how long min2phase works on it.

| probes | time per call | 17 moves or fewer | 18 or fewer |
|---|---|---|---|
| 60 | 2.6 ms | 1.0% | 4.4% |
| 250 | 9.1 ms | 1.7% | 9.3% |
| 500 | 18.8 ms | 1.7% | 12.2% |
| 2000 | 76.2 ms | 2.4% | 20.0% |

So the way to a short total is to look at more reductions, not to work harder
on each. What limits that is how fast short reductions can be supplied.

## Tried and not adopted

Each of these was implemented and measured. They are listed so they are not
retried blindly.

- **Telling the 3x3x3 solver the length it has to beat.** Not cheaper: its cost
  is in generating phase-1 candidates, not in finishing them. 35 ms a call
  against 31.
- **Fewer probes per 3x3x3 solve, to screen more reductions.** With 60 probes
  one thread screened twice as many reductions and its result was 0.4 moves
  worse. Reductions are not cheap enough to find for breadth to pay.
- **Different whole-cube rotations for groups of threads.** 42.54 to 42.58
  against 42.40 for one shared search.
- **One whole search per thread on a rotated cube.** The searches converge:
  0.23 moves from twelve threads at 5 s.
- **Skipping reductions that only add a trailing outer-face turn.** They are
  about 17% of what gets screened. Dropping them is sound and is on, but the
  effect on the average is within noise.
- **A deep 3x3x3 pass on the best candidates at long budgets.** With the search
  split across threads it found nothing to do, and at 10 s it ended solves
  1.5 s early for the same average. Off in multi-thread mode.
- **Choosing the last two moves of phase 2 by table lookup.** Kept, because it
  builds the identical pool 1.5 times faster, but the hoped-for 3 to 5 times
  did not appear: the search tree above the last two moves is deep and thin.
- **Solving the inverse scramble and inverting the answer.** Cannot work on a
  4x4x4, where same-coloured centre pieces are indistinguishable and the
  inverse state is therefore not defined by the colouring.
- **Restarting the search from each of several first moves, on one core.** The
  restarts cost what they gain: +0.08 moves, 95% CI [−0.11, 0.26].

## Single-core results

The browser version runs the same search on one core. Over all 2000 scrambles
at a 5 s budget:

| solver | average | sd | best | worst |
|---|---|---|---|---|
| stock three-phase, TPR's parameters | 44.224 | 1.254 | 39 | 48 |
| this solver, one core, 5 s | 42.458 | 1.044 | 38 | 45 |

Paired improvement 1.767 moves, 95% CI [1.715, 1.818]; shorter on 1703
scrambles, equal on 297, longer on none. At 30 s over 150 scrambles it averaged
42.167. Both solvers' solutions and the per-scramble data are in `results/`,
and `node bench/analyze.mjs 2000` re-derives these figures from the files
without running the solver.

## Reproducing

```bash
npm install
node bench/verify.js 40 2000
node bench/parallel.js --from 300 --count 300 --configs 1:0:stock,12:300,12:1000,12:1500 --save results/run.tsv
node bench/check-parallel.mjs results/run.tsv
```

A configuration is `threads:budgetMs[:mode]`. `1:0:stock` times the unmodified
solver on one thread. `--timing hard` benchmarks the strict cap. Run on mains
power with nothing else using the machine, and expect the averages to move by
up to about 0.1 between runs.
