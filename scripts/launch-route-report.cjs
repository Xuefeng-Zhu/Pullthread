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
const { createEndlessRun, createLegacyEndlessRun, nextEndlessChallenge, nextEndlessTargets, stepEndless } = require(path.join(base, 'endless.ts'));
const { bankWitness } = require(path.join(base, 'testing/bankPatternVerification.ts'));
const { flightPatternWitness, flyPattern } = require(path.join(base, 'testing/flightPatternHelpers.ts'));
const { findNextInput, findTargetInput, replayNext } = require(path.join(base, 'testing/routeSolver.ts'));
const { INTERACTIVE_SECTION_PATTERNS, mirrorInteractiveSection } = require(path.join(base, 'interactiveSections.ts'));
const seed = Number(process.argv[2] ?? 0) >>> 0;
const legacy = process.argv.includes('--legacy');
const layoutInputs = legacy ? CHALLENGE_PATTERNS.map(pattern => {
  const witness = pattern.family === 'bank'
    ? { pull: bankWitness(pattern.id), releaseTick: 0 }
    : flightPatternWitness(pattern);
  const result = flyPattern(pattern, witness.pull, pattern.entryX.min, witness.releaseTick);
  if (!result.caught) throw Error(`Rejected witness: ${pattern.id}`);
  return { pattern: pattern.id, entryX: pattern.entryX.min, ...witness,
    captureTick: result.tick, bounces: result.bounces };
}) : INTERACTIVE_SECTION_PATTERNS.flatMap(pattern => [pattern, mirrorInteractiveSection(pattern)])
  .map(pattern => ({ pattern: pattern.id, family: pattern.family, mechanics: pattern.mechanics, connections: pattern.connections }));
const run = legacy ? createLegacyEndlessRun(seed) : createEndlessRun(seed);
const runInputs = [];
for (let catchNumber = 1; catchNumber <= 128; catchNumber++) {
  const pattern = nextEndlessChallenge(run)?.patternId ?? 'opening';
  const choices = nextEndlessTargets(run);
  const target = choices[(catchNumber + seed) % choices.length];
  const input = legacy ? findNextInput(run) : findTargetInput(run, target);
  const setup = [];
  for (const attempt of input.setup ?? []) {
    const startTick = run.state.tick;
    const events = replayNext(run, attempt);
    if (run.state.phase !== 'held') throw Error(`Failed setup for catch ${catchNumber}`);
    setup.push({ ...attempt, startTick, captureTick: run.state.tick, pocketId: run.state.pocketId,
      interactions: events.filter(event => event.type === 'break' || event.type === 'switch') });
  }
  const { pull, waitTicks } = input;
  const releaseTick = run.state.tick + waitTicks;
  const pocketId = run.state.pocketId;
  const events = replayNext(run, { pull, waitTicks });
  if (run.state.pocketId !== target || run.state.phase !== 'held') throw Error(`Failed catch ${catchNumber}`);
  runInputs.push({ catchNumber, pattern, pocketId, target, choices, setup, releaseTick, pull, captureTick: run.state.tick,
    bounces: events.filter(event => event.type === 'bounce').length,
    interactions: events.filter(event => event.type === 'break' || event.type === 'switch') });
  // A real player sees the catch settle before beginning the next gesture.
  if (!legacy) for (let tick = 0; tick < 96; tick++) stepEndless(run);
}
process.stdout.write(JSON.stringify({ simulationHz: 120, generationVersion: run.generationVersion, seed, layoutInputs, runInputs }, null, 2) + '\n');
