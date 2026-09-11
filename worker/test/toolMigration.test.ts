import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { URL } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { D1CommerceWallet } from '../src/wallet';

const migration = async (file: string) => (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  .split('\n').filter(line => line.trim() && !line.trimStart().startsWith('--'));

test('creative-tool migration preserves every historical receipt and revive foreign key', async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }', compatibilityDate: '2026-09-07', d1Databases: ['DB'] }));
  try {
    const db = await runtime.getD1Database('DB') as unknown as D1Database;
    for (const file of ['0001_commerce.sql', '0002_weekly.sql', '0003_cosmetics.sql']) await db.batch((await migration(file)).map(sql => db.prepare(sql)));
    const wallet = new D1CommerceWallet(db);
    await wallet.applyVerifiedPurchase('migration-player', { transactionId: 'migration-purchase', productId: 'pullthread_points_550', store: 'app_store', environment: 'sandbox', purchasedAt: 100, quantity: 1, refunded: false });
    const base = { runId: 'migration-run', contextKey: '0:endless-0:revive:', tool: 'revive' as const, expectedCost: 50 };
    for (const status of ['ready', 'applied', 'refunded'] as const) {
      const operationId = `migration-${status}`;
      await wallet.redeemTool('migration-player', 'sandbox', { ...base, runId: `migration-run-${status}`, operationId });
      if (status !== 'ready') await wallet.resolveTool('migration-player', 'sandbox', operationId, status === 'applied' ? 'applied' : 'refund');
    }
    const receiptsBefore = (await db.prepare('SELECT * FROM commerce_redemptions ORDER BY operation_id').all()).results;
    const reservationsBefore = (await db.prepare('SELECT * FROM commerce_revive_reservations ORDER BY operation_id').all()).results;
    const walletBefore = await wallet.getWallet('migration-player', 'sandbox');
    await db.batch((await migration('0004_creative_tools.sql')).map(sql => db.prepare(sql)));
    assert.deepEqual((await db.prepare('SELECT * FROM commerce_redemptions ORDER BY operation_id').all()).results, receiptsBefore);
    assert.deepEqual((await db.prepare('SELECT * FROM commerce_revive_reservations ORDER BY operation_id').all()).results, reservationsBefore);
    assert.deepEqual(await wallet.getWallet('migration-player', 'sandbox'), walletBefore);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    await assert.rejects(wallet.redeemTool('migration-player', 'sandbox', { ...base, runId: 'migration-run-applied', operationId: 'migration-second-revive' }), /already redeemed/);
    await wallet.redeemTool('migration-player', 'sandbox', { ...base, operationId: 'migration-new-bounce', tool: 'bounce', expectedCost: 15 });
    await assert.rejects(db.prepare("INSERT INTO commerce_redemptions(uid,environment,operation_id,run_id,tool,expected_cost,context_key,status,allocations) VALUES ('migration-player','sandbox','bad-tool','migration-run','unknown',1,'context','ready','[]')").run(), /CHECK constraint/);
    await wallet.resolveTool('migration-player', 'sandbox', 'migration-ready', 'refund');
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM commerce_revive_reservations WHERE operation_id='migration-ready'").first<{ count: number }>())?.count, 0);
  } finally { await runtime.dispose(); }
});

test('web-billing migration preserves native lots and expands the transaction store constraint', async () => {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("fixture"); } }', compatibilityDate: '2026-09-07', d1Databases: ['DB'] }));
  try {
    const db = await runtime.getD1Database('DB') as unknown as D1Database;
    for (const file of ['0001_commerce.sql', '0002_weekly.sql', '0003_cosmetics.sql', '0004_creative_tools.sql']) {
      await db.batch((await migration(file)).map(sql => db.prepare(sql)));
    }
    const wallet = new D1CommerceWallet(db);
    await wallet.applyVerifiedPurchase('migration-web-player', { transactionId: 'native-before-web',
      productId: 'pullthread_points_100', store: 'app_store', environment: 'sandbox', purchasedAt: 100, quantity: 1, refunded: false });
    await db.batch((await migration('0005_web_billing.sql')).map(sql => db.prepare(sql)));
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
    assert.equal((await wallet.getWallet('migration-web-player', 'sandbox')).points, 100);
    await wallet.applyVerifiedPurchase('migration-web-player', { transactionId: 'web-after-migration',
      productId: 'pullthread_points_100', store: 'rc_billing', environment: 'sandbox', purchasedAt: 200, quantity: 1, refunded: false });
    assert.equal((await wallet.getWallet('migration-web-player', 'sandbox')).points, 200);
    await assert.rejects(db.prepare("INSERT INTO commerce_transactions(tx_key,uid,environment,transaction_id,product_id,store,quantity,purchased_at,refunded,points) VALUES ('bad-store','migration-web-player','sandbox','bad','pullthread_points_100','unknown',1,300,0,100)").run(), /CHECK constraint/);
  } finally { await runtime.dispose(); }
});
