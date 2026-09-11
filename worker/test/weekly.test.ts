import { createRankedSimulation, toolContext } from '../../src/leaderboard/replay';
import { eligibleTeleportPockets } from '../../src/game/launch/endless';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WeeklyLeaderboard } from '../src/leaderboard';
import { D1CommerceWallet } from '../src/wallet';
import { RULESET, WEEK_MS, weekStart } from '../../src/leaderboard/contracts';
import type { Env } from '../src/env';
let runtime: Miniflare, db: D1Database, board: WeeklyLeaderboard, wallet: D1CommerceWallet, env: Env;
let now = Date.UTC(2026, 8, 7, 12);
before(async () => {
  runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("test"); } }', compatibilityDate: '2026-09-07', d1Databases: ['DB'] }));
  db = await runtime.getD1Database('DB') as unknown as D1Database;
  for (const file of ['0001_commerce.sql', '0002_weekly.sql', '0003_cosmetics.sql', '0004_creative_tools.sql']) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8');
    await db.exec(migration.split('\n').filter(line => line.trim() && !line.startsWith('--')).join('\n'));
  }
  env = { DB: db, LEADERBOARD_ENABLED_ENVIRONMENTS: 'sandbox', LEADERBOARD_PRIZES_ENABLED: 'sandbox' };
  board = new WeeklyLeaderboard(env, () => now); wallet = new D1CommerceWallet(db);
});
after(async () => { await runtime?.dispose(); });
test('UTC week changes at Monday midnight across year boundaries', () => {
  assert.equal(weekStart(Date.UTC(2026, 8, 6, 23, 59, 59)), Date.UTC(2026, 7, 31));
  assert.equal(weekStart(Date.UTC(2026, 8, 7)), Date.UTC(2026, 8, 7));
  assert.equal(weekStart(Date.UTC(2027, 0, 1)), Date.UTC(2026, 11, 28));
});
test('server run registration is idempotent and scopes seeds and identity', async () => {
  const a = await board.register('player-a', 'sandbox', 'register-a');
  assert.deepEqual(await board.register('player-a', 'sandbox', 'register-a'), a);
  const b = await board.register('player-b', 'sandbox', 'register-a');
  assert.notEqual(a.id, b.id); assert.equal(a.ruleset, 'stitched-v4-weekly-3');
  const batch = { sequence: 0, from: 0, to: 120, commands: [] };
  assert.deepEqual(await board.upload('player-a', 'sandbox', a.id, batch), { sequence: 0, score: 0 });
  assert.deepEqual(await board.upload('player-a', 'sandbox', a.id, batch), { sequence: 0, score: 0 });
  await assert.rejects(board.upload('player-a', 'sandbox', a.id, { ...batch, to: 119 }), /already used/);
  await assert.rejects(board.upload('player-b', 'sandbox', a.id, batch), /unavailable/);
  await assert.rejects(board.upload('player-a', 'production', a.id, batch), /unavailable/);
  await assert.rejects(board.upload('player-a', 'sandbox', a.id, { sequence: 1, from: 120, to: 361, commands: [] }), /Invalid replay/);
  now += 1000;
  await assert.rejects(board.upload('player-a', 'sandbox', a.id, { sequence: 1, from: 120, to: 121, commands: [{ at: 120, type: 'tool', tool: 'teleport', pocketId: 'pocket-1', operationId: 'fake-paid' }] }), /could not be verified/);
  assert.equal((await board.standings('player-a', 'sandbox')).own, null);
});
test('old registrations continue through their frozen replay engines', async () => {
  for (const ruleset of ['stitched-v4-weekly-1', 'stitched-v4-weekly-2']) {
    const uid = `legacy-player-${ruleset}`;
    const legacy = await board.register(uid, 'sandbox', `legacy-register-${ruleset}`);
    await db.prepare('UPDATE weekly_runs SET ruleset=? WHERE id=?').bind(ruleset, legacy.id).run();
    assert.deepEqual(await board.register(uid, 'sandbox', `legacy-register-${ruleset}`, RULESET), { ...legacy, ruleset });
    const batch = { sequence: 0, from: 0, to: 120, commands: [] };
    assert.deepEqual(await board.upload(uid, 'sandbox', legacy.id, batch), { sequence: 0, score: 0 });
  }
});
test('registration negotiates explicit rulesets while keeping prior request identities', async () => {
  const creative = await board.register('creative-player', 'sandbox', 'creative-register', RULESET);
  assert.equal(creative.ruleset, RULESET);
  assert.deepEqual(await board.register('creative-player', 'sandbox', 'creative-register', 'stitched-v4-weekly-3'), creative);
  const legacy = await board.register('legacy-request', 'sandbox', 'legacy-register');
  assert.equal(legacy.ruleset, 'stitched-v4-weekly-3');
  assert.deepEqual(await board.register('legacy-request', 'sandbox', 'legacy-register', RULESET), legacy);
  const installed = await board.register('installed-v5', 'sandbox', 'installed-v5-register', 'stitched-v5-weekly-1');
  assert.equal(installed.ruleset, 'stitched-v5-weekly-1');
  assert.deepEqual(await board.register('installed-v5', 'sandbox', 'installed-v5-register', RULESET), installed);
  const installedV6 = await board.register('installed-v6', 'sandbox', 'installed-v6-register', 'stitched-v6-weekly-1');
  assert.equal(installedV6.ruleset, 'stitched-v6-weekly-1');
  assert.deepEqual(await board.register('installed-v6', 'sandbox', 'installed-v6-register', RULESET), installedV6);
  await assert.rejects(board.register('bad-ruleset', 'sandbox', 'bad-register', 'unknown'), /version is unavailable/);
  await assert.rejects(board.register('bad-ruleset', 'sandbox', 'bad-register-proto', 'constructor'), /version is unavailable/);
  await assert.rejects(board.register('bad-ruleset', 'sandbox', 'bad-register-retired', 'stitched-v4-weekly-1'), /version is unavailable/);
  await assert.rejects(board.register('bad-ruleset', 'sandbox', 'bad-register-null', null), /version is unavailable/);
});
test('FIFO pickup inventory is isolated to generation 6 while installed v5 runs remain uncapped', async () => {
  for (const [ruleset, generation] of [['stitched-v5-weekly-1', 5], [RULESET, 6]] as const) {
    const uid = `inventory-player-v${generation}`;
    const ranked = await board.register(uid, 'sandbox', `inventory-register-v${generation}`, ruleset);
    const row = await db.prepare('SELECT checkpoint FROM weekly_runs WHERE id=?').bind(ranked.id).first<{ checkpoint: string }>();
    const checkpoint = JSON.parse(row!.checkpoint);
    assert.equal(checkpoint.run.generationVersion, generation);
    checkpoint.run.inventory.preview = 1;
    checkpoint.run.inventory.sail = 1;
    checkpoint.run.inventory.needle = 1;
    if (generation === 6) checkpoint.run.freeToolQueue = ['preview', 'sail', 'needle'];
    else assert.equal(checkpoint.run.freeToolQueue, undefined);
    checkpoint.run.room.pickups = [{ id: 'inventory-fourth-pickup', kind: 'bounce', radius: 12,
      center: { x: checkpoint.run.state.position.x, y: checkpoint.run.state.position.y + 90 } }];
    await db.prepare('UPDATE weekly_runs SET checkpoint=? WHERE id=?').bind(JSON.stringify(checkpoint), ranked.id).run();
    const batch = { sequence: 0, from: 0, to: 1, commands: [
      { type: 'aim' as const, at: 0 }, { type: 'launch' as const, at: 0, x: 0, y: 90 },
    ] };
    assert.deepEqual(await board.upload(uid, 'sandbox', ranked.id, batch), { sequence: 0, score: 0 });
    assert.deepEqual(await board.upload(uid, 'sandbox', ranked.id, batch), { sequence: 0, score: 0 });
    const saved = await db.prepare('SELECT checkpoint FROM weekly_runs WHERE id=?').bind(ranked.id).first<{ checkpoint: string }>();
    const run = JSON.parse(saved!.checkpoint).run;
    assert.equal(run.inventory.bounce, 1);
    assert.equal(run.inventory.preview, generation === 6 ? 0 : 1);
    assert.equal(run.inventory.sail, 1);
    assert.equal(run.inventory.needle, 1);
    assert.equal(Object.values<number>(run.inventory).reduce((sum, count) => sum + count, 0), generation === 6 ? 3 : 4);
    if (generation === 6) assert.deepEqual(run.freeToolQueue, ['sail', 'needle', 'bounce']);
    else assert.equal(run.freeToolQueue, undefined);
  }
});
test('only an applied, run-bound paid tool can contribute a verified catch', async () => {
  const ranked = await board.register('tool-player', 'sandbox', 'tool-register', RULESET);
  const live = createRankedSimulation(ranked.seed);
  const target = eligibleTeleportPockets(live)[0];
  assert.ok(target);
  await wallet.applyVerifiedPurchase('tool-player', { transactionId: 'weekly-tool-pack', productId: 'pullthread_points_100', environment: 'sandbox', store: 'app_store', quantity: 1, purchasedAt: now, refunded: false });
  const request = { operationId: 'weekly-paid-teleport', runId: ranked.id, contextKey: `0:${live.state.pocketId}:teleport:${target.id}`, tool: 'teleport' as const, expectedCost: 25 };
  await wallet.redeemTool('tool-player', 'sandbox', request);
  const batch = { sequence: 0, from: 0, to: 0, commands: [{ at: 0, type: 'tool' as const, tool: 'teleport' as const, pocketId: target.id, operationId: request.operationId }] };
  await assert.rejects(board.upload('tool-player', 'sandbox', ranked.id, batch), /could not be verified/);
  await wallet.resolveTool('tool-player', 'sandbox', request.operationId, 'applied');
  assert.deepEqual(await board.upload('tool-player', 'sandbox', ranked.id, batch), { sequence: 0, score: 1 });
  assert.equal((await board.standings('tool-player', 'sandbox')).own?.score, 1);
  assert.equal((await wallet.getWallet('tool-player', 'sandbox')).points, 75);
});
test('new rulesets verify a paid creative effect once using its exact receipt context', async () => {
  const uid = 'creative-paid-player';
  const ranked = await board.register(uid, 'sandbox', 'creative-paid-register', RULESET);
  const live = createRankedSimulation(ranked.seed);
  const command = { type: 'tool' as const, tool: 'sail' as const, at: 0, operationId: 'creative-paid-sail' };
  await wallet.applyVerifiedPurchase(uid, { transactionId: 'creative-paid-pack', productId: 'pullthread_points_100', environment: 'sandbox', store: 'app_store', quantity: 1, purchasedAt: now, refunded: false });
  const request = { operationId: command.operationId, runId: ranked.id, contextKey: toolContext(live, command), tool: command.tool, expectedCost: 10 };
  await wallet.redeemTool(uid, 'sandbox', request);
  const batch = { sequence: 0, from: 0, to: 0, commands: [command] };
  await assert.rejects(board.upload(uid, 'sandbox', ranked.id, batch), /could not be verified/);
  await wallet.resolveTool(uid, 'sandbox', command.operationId, 'applied');
  await assert.rejects(board.upload(uid, 'sandbox', ranked.id, { ...batch, commands: [{ ...command, tool: 'needle' }] }), /could not be verified/);
  assert.deepEqual(await board.upload(uid, 'sandbox', ranked.id, batch), { sequence: 0, score: 0 });
  assert.deepEqual(await board.upload(uid, 'sandbox', ranked.id, batch), { sequence: 0, score: 0 });
  const row = await db.prepare('SELECT checkpoint FROM weekly_runs WHERE id=?').bind(ranked.id).first<{ checkpoint: string }>();
  assert.equal(JSON.parse(row!.checkpoint).run.state.toolEffects.sail, true);
  assert.equal((await wallet.getWallet(uid, 'sandbox')).points, 90);
});
test('settlement freezes ties in acceptance order, grants 100/50/25 once, and separates environments', async () => {
  const week = weekStart(now);
  for (const [uid, score] of [['winner-a', 60], ['winner-b', 60], ['winner-c', 40], ['winner-d', 20]] as const) {
    await board.register(uid, 'sandbox', `register-${uid}`);
    await db.prepare('INSERT INTO weekly_entries(uid,environment,week,score) VALUES (?,?,?,?)').bind(uid, 'sandbox', week, score).run();
  }
  const ranks = await board.standings('winner-b', 'sandbox');
  assert.equal(ranks.own?.rank, 2);
  now = week + WEEK_MS;
  await Promise.all([board.settle(), board.settle()]);
  assert.equal((await wallet.getWallet('winner-a', 'sandbox')).points, 100);
  assert.equal((await wallet.getWallet('winner-b', 'sandbox')).points, 50);
  assert.equal((await wallet.getWallet('winner-c', 'sandbox')).points, 25);
  assert.equal((await wallet.getWallet('winner-d', 'sandbox')).points, 0);
  assert.equal((await wallet.getWallet('winner-a', 'production')).points, 0);
  await board.settle();
  assert.equal((await wallet.getWallet('winner-a', 'sandbox')).revision, 1);
  const late = await board.register('player-a', 'sandbox', 'register-a');
  await assert.rejects(board.upload('player-a', 'sandbox', late.id, { sequence: 1, from: 120, to: 121, commands: [] }), /week has ended/);
  assert.equal((await board.standings('winner-a', 'sandbox')).previous.length, 3);
});
test('reward points spend and tool refunds restore them without purchase transactions', async () => {
  const operation = { operationId: 'reward-spend', runId: 'reward-run', contextKey: '0:pocket:preview', tool: 'preview' as const, expectedCost: 10 };
  await wallet.redeemTool('winner-a', 'sandbox', operation);
  assert.equal((await wallet.getWallet('winner-a', 'sandbox')).points, 90);
  await wallet.resolveTool('winner-a', 'sandbox', operation.operationId, 'refund');
  assert.equal((await wallet.getWallet('winner-a', 'sandbox')).points, 100);
  const count = await db.prepare('SELECT COUNT(*) AS count FROM commerce_transactions WHERE uid=?').bind('winner-a').first<{ count: number }>();
  assert.equal(count?.count, 0);
});
test('practice weeks cannot receive retroactive prizes when payouts are enabled later', async () => {
  env.LEADERBOARD_PRIZES_ENABLED = '';
  const week = weekStart(now);
  await board.register('practice', 'sandbox', 'practice-start');
  await db.prepare('INSERT INTO weekly_entries(uid,environment,week,score) VALUES (?,?,?,?)').bind('practice', 'sandbox', week, 10).run();
  now += WEEK_MS;
  await board.settle(); env.LEADERBOARD_PRIZES_ENABLED = 'sandbox'; await board.settle();
  assert.equal((await wallet.getWallet('practice', 'sandbox')).points, 0);
});
