const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('../worker/node_modules/esbuild');

const root = path.resolve(__dirname, '..');
const id = process.argv[2];
if (!/^stitched-v4-weekly-[1-9]\d*$/.test(id ?? '')) throw new Error('Pass a versioned stitched-v4-weekly-N ruleset ID.');
const base = path.join(root, 'worker', 'rulesets', id);
for (const extension of ['js', 'd.ts', 'sources.json']) {
  if (fs.existsSync(`${base}.${extension}`)) throw new Error(`Ruleset ${id} already exists and cannot be overwritten.`);
}

void esbuild.build({
  stdin: {
    contents: `export { createRankedSimulation, replayBatch, validateBatch } from './src/leaderboard/replay';\nexport { deserializeEndlessRun, serializeEndlessRun } from './src/game/launch/snapshots';\n`,
    resolveDir: root,
    sourcefile: `${id}.entry.ts`,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  treeShaking: true,
  minify: false,
  metafile: true,
  write: false,
  banner: { js: '// Frozen competition engine. See README.md; never modify a released ruleset.' },
}).then((result) => {
  const inputs = Object.keys(result.metafile.inputs)
    .map((file) => path.relative(root, path.resolve(root, file)).replaceAll(path.sep, '/'))
    .filter((file) => file.startsWith('src/'))
    .sort();
  const manifest = Object.fromEntries(inputs.map((file) => [
    file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
  ]));
  fs.writeFileSync(`${base}.js`, result.outputFiles[0].contents);
  fs.writeFileSync(`${base}.d.ts`, "export { createRankedSimulation, replayBatch, validateBatch } from '../../src/leaderboard/replay';\nexport { deserializeEndlessRun, serializeEndlessRun } from '../../src/game/launch/snapshots';\n");
  fs.writeFileSync(`${base}.sources.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${id} from ${inputs.length} source files.`);
});
