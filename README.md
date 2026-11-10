# QuadSolver

A 4x4x4 (Rubik's Revenge) solver that works to a time budget and uses every
core. It reduces the cube to a 3x3x3 with Shuang Chen's three-phase reduction
and finishes with Kociemba's two-phase algorithm, like the solver in csTimer.
The difference is what it does with the time: instead of taking the first
reduction it finds, it searches many of them in parallel and keeps the one whose
complete solution is shortest.

On 300 test scrambles the stock three-phase solver averages 44.4 moves. On a
6-core laptop this one averages 43.0 in 0.3 s and 42.0 in 1.5 s, and
saves about 2.6 moves at 3 s, after which more time buys nothing measurable.
Moves are counted in OBTM.

## Results

| solving time | average moves | stock solver, same scrambles | moves saved | scrambles |
|---|---|---|---|---|
| 0.3 s | 43.01 | 44.38 | 1.37 | 300 |
| 1 s | 42.20 | 44.38 | 2.17 | 300 |
| **1.5 s (default)** | **42.00** | 44.38 | **2.38** | 300 |
| 3 s | 41.61 | 44.20 | 2.59 | 150 |
| 5 s | 41.56 | 44.13 | 2.57 | 100 |
| 10 s | 41.40 | 43.90 | 2.50 | 80 |

The stock solver takes 0.13 s on average and up to 0.67 s, on one thread. The
three longest tiers were run on different scrambles from the first three, so
compare them by moves saved: 3 s is the last tier that buys anything
measurable. Solving time is the average per solve; the slowest solve in any
tier was 4% over its budget.

Every solution in these runs was replayed through [cubing.js](https://js.cubing.net/cubing/),
which shares no code with this solver. Method, raw data and the things that did
not work are in [RESULTS.md](RESULTS.md).

These figures depend on the machine. They come from a 6-core, 12-thread
Ryzen 5 PRO 230 on mains power. Fewer or slower cores give longer solutions at
the same budget, and a laptop on battery runs at roughly half speed.

## Running it

Node 18 or later. No dependencies are needed to solve.

```bash
node bin/solve.js "R U Rw2 F' Uw L2 Fw' D2 B Rw"
node bin/solve.js --random --budget 300
node bin/solve.js --state <96 facelets, URFDLB order> --json
node bin/solve.js --stdin < scrambles.txt
```

| option | meaning |
|---|---|
| `--budget <ms>` | solving time per cube, default 1500 |
| `--strict` | treat the budget as a cap no solve may exceed, instead of an average |
| `--threads <n>` | worker threads, default every logical core |
| `--stdin` | build the tables once, then solve one scramble or state per line |
| `--json` | print one JSON object per solve |

Start-up is not part of the budget. Each run builds its lookup tables and runs
a few warm-up solves, 3 to 5 s in all. The first run on a machine also builds a
larger table, about 20 s, and saves it in `.cache/`. To solve many cubes, use
`--stdin` so that start-up happens once.

There is also a single-threaded browser version in `web/`. It needs a static
file server because it runs in a Web Worker; `serve.ps1` is one for Windows,
and `npx serve .` works anywhere.

## How it works

| phase | what it solves | typical moves |
|---|---|---|
| 1 | centres on one axis | 7 |
| 2 | the remaining centres, with the edges arranged so they can be paired | 6 |
| 3 | pairs all 12 dedges, leaving a 3x3x3 | 12 |
| 4 | the 3x3x3, with min2phase | 17 to 18 |

The stock solver stops at the first complete reduction, which minimises phases
1 to 3 and ignores what phase 4 will then cost. Total length is what matters,
so this solver:

1. builds a pool of phase 1 and 2 results, each a starting point for phase 3;
2. enumerates many phase 3 solutions from them, shortest first;
3. solves each resulting 3x3x3 quickly, and keeps the reduction whose total is
   shortest.

Four things make that fit in a second or less.

**One search, split across the threads.** Each thread expands its own slice of
the phase 1 solutions into its own part of the pool, then searches that part.
The threads share only the best total found so far, through a
`SharedArrayBuffer`, so each can drop a branch that cannot beat it. Giving each
thread a whole search of its own was tried first and is much weaker, because the
searches converge on the same answer.

**A large pool.** How many phase 1 and 2 results the search starts from matters
more than how hard it searches them: a larger pool contains shorter reductions.
Building the pool in slices is what makes a large one affordable.

**A complete edge table for phase 3.** The original table stops at depth 9 to
start quickly, which leaves 91% of its 31 million entries unknown. Finishing it
makes the phase 3 search about 1.5 times faster and lets candidates be ranked
by an exact bound. It is built once and shared by every thread.

**A real time limit.** The search checks the clock inside phase 3, the last
3x3x3 solves shrink to fit the time left, and the pool returns the best verified
answer at its deadline rather than waiting for a slow thread.

Parity needs no special handling. Edge parity is part of the phase 2 and phase 3
coordinates, so the search cannot reach a parity-blocked state, and there are no
OLL or PLL parity algorithms in the code.

## Checking the results

```bash
npm install                      # cubing.js, used only for verification
node bench/verify.js 40 2000     # correctness gate: every solution must solve its cube
node bench/parallel.js --from 1400 --count 300 --configs 12:300,12:1500 --save results/run.tsv
node bench/check-parallel.mjs results/run.tsv
```

`bench/parallel.js` solves a range of the 2000 saved scrambles and pairs each
result with the stock solver's result for the same scramble.
`bench/check-parallel.mjs` replays every saved solution through cubing.js and
recounts the moves from the solution strings.

## Limits

- It is the same reduction method as TPR, searched more widely. It is not a new
  way of solving the cube, and its solutions are not optimal or close to it.
- More time helps less and less. Going from 1.5 s to 3 s buys about 0.2 moves,
  and from 3 s to 10 s nothing that could be measured.
- Most solutions leave the cube solved but turned, for example with green on
  top where white started. A 4x4x4 has no fixed centres, so that is a solved
  cube, but the program does not say which way up it will finish.
- At the shortest budget the answer is occasionally a move longer than the
  stock solver's, because the search is cut off before it has covered what the
  stock solver covers.
- The budget is kept on average, with the slowest solves a few percent over.
  `--strict` turns it into a cap, at the cost of some search time. Even then, a
  desktop operating system can hold a busy process off the CPU for a moment, so
  it is a very reliable limit rather than a guarantee.

## How it got here

The dated notes for this project run from September to November 2026. It did
not go in a straight line, and the wrong turns are part of the record.

- **September.** The starting assumption was that a reduction solver needs 50
  to 65 moves, and the plan was to write one from scratch. Measuring first
  showed that csTimer's port of TPR already averages about 44, so the work
  became improving on that. Searching many reductions and scoring each by its
  total brought the average to 42.5 at a 5 s budget, single-threaded in the
  browser, over 2000 scrambles.
- **A wrong number, found and withdrawn.** An early write-up claimed a 1.88 move
  improvement. The baseline had been run with a weaker 3x3x3 setting than TPR
  really uses, through a mistake in this project's own glue code. With the
  baseline fixed the improvement was 1.77, and that is the figure that was kept.
- **An idea that could not work.** Solving the inverse scramble and inverting
  the answer looked like a free second attempt. It was reported as "never wins"
  until it turned out the code was silently falling back every time. On a 4x4x4
  the inverse is not well defined, because centre pieces of one colour cannot
  be told apart. It is switched off.
- **A benchmark that lied.** Results drifted between sessions until the cause
  was found: the laptop runs at about half speed on battery, and a solver with
  a time budget does less in the same time. Benchmarks are now run on mains
  power and record a fixed-work timing next to every result.
- **October.** Moving from the browser to Node was at first five to seven times
  slower. The cause was the sandbox the code was loaded into, not Node.
  Without it Node matched the browser, and worker threads became possible. The
  first parallel design, one whole search per thread on a rotated cube, gained
  only 0.2 moves from twelve threads. Splitting one search across the threads
  did better: 1.5 s on twelve threads matched 5 s on one.
- **November.** A detour first: making the search about 30% faster changed
  nothing measurable, which the earlier measurements predicted, since six
  times the search had been worth only 0.36 moves. What did help was the size
  of the starting pool, which had been fixed at 300 since September. Most of
  the gain over the October version came from there: about 0.4 moves at 1.5 s.

## Credits and licence

This is a derivative work, and most of the difficult ideas in it are other
people's.

- [TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver) by Shuang Chen
  (cs0x7f): the three-phase reduction.
- [min2phase](https://github.com/cs0x7f/min2phase) by Shuang Chen: the 3x3x3
  two-phase solver, after Herbert Kociemba's algorithm.
- [csTimer](https://github.com/cs0x7f/cstimer) by Shuang Chen: the JavaScript
  ports of both, vendored unmodified in `vendor/`. `src/tpr444.js` is a modified
  copy of csTimer's `scramble_444.js`, with every change marked.
- [cubing.js](https://github.com/cubing/cubing.js): used to verify solutions.

GPL-3.0, as required by the code this builds on. See [LICENSE](LICENSE).
