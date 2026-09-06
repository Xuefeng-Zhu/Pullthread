/* Offline authoring report. This script and imported testing helpers never enter the app. */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, filename);
const base = path.resolve(__dirname, '../src/game/launch');
const { CHALLENGE_PATTERNS } = require(path.join(base, 'challenges.ts'));
const { createEndlessRun, nextEndlessChallenge } = require(path.join(base, 'endless.ts'));
const { bankWitness } = require(path.join(base, 'testing/bankPatternVerification.ts'));
const { flightPatternWitness, flyPattern } = require(path.join(base, 'testing/flightPatternHelpers.ts'));
const { findNextInput, replayNext } = require(path.join(base, 'testing/routeSolver.ts'));
const seed = Number(process.argv[2] ?? 0) >>> 0;
const layoutInputs = CHALLENGE_PATTERNS.map(pattern => {
  const witness = pattern.family === 'bank'
    ? { pull: bankWitness(pattern.id), releaseTick: 0 }
    : flightPatternWitness(pattern);
  const result = flyPattern(pattern, witness.pull, pattern.entryX.min, witness.releaseTick);
  if (!result.caught) throw Error(`Rejected witness: ${pattern.id}`);
  return { pattern: pattern.id, entryX: pattern.entryX.min, ...witness,
    captureTick: result.tick, bounces: result.bounces };
});
const run = createEndlessRun(seed);
const runInputs = [];
for (let catchNumber = 1; catchNumber <= 128; catchNumber++) {
  const pattern = nextEndlessChallenge(run).patternId;
  const { pull, waitTicks } = findNextInput(run);
  const releaseTick = run.state.tick + waitTicks;
  const pocketId = run.state.pocketId;
  const target = run.nextPocketId;
  const events = replayNext(run, { pull, waitTicks });
  if (run.state.pocketId !== target || run.state.phase !== 'held') throw Error(`Failed catch ${catchNumber}`);
  runInputs.push({ catchNumber, pattern, pocketId, releaseTick, pull, captureTick: run.state.tick,
    bounces: events.filter(event => event.type === 'bounce').length });
}
process.stdout.write(JSON.stringify({ simulationHz: 120, seed, layoutInputs, runInputs }, null, 2) + '\n');
