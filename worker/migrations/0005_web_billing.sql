-- RevenueCat Web Billing, Stripe Billing, and Paddle Billing purchases share
-- the existing globally deduplicated transaction and FIFO wallet-lot pipeline.
CREATE TABLE commerce_lots_web_backup AS SELECT uid, environment, tx_key, remaining, purchased_at, active, revoked FROM commerce_lots;
DROP TABLE commerce_lots;
CREATE TABLE commerce_transactions_v5 (tx_key TEXT PRIMARY KEY NOT NULL, uid TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')), transaction_id TEXT NOT NULL, product_id TEXT NOT NULL, store TEXT NOT NULL CHECK(store IN ('app_store','play_store','rc_billing','stripe','paddle')), quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 100), purchased_at INTEGER NOT NULL, refunded INTEGER NOT NULL CHECK(refunded IN (0,1)), points INTEGER NOT NULL CHECK(points > 0), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(uid, environment) REFERENCES commerce_wallets(uid, environment));
INSERT INTO commerce_transactions_v5 (tx_key, uid, environment, transaction_id, product_id, store, quantity, purchased_at, refunded, points, updated_at) SELECT tx_key, uid, environment, transaction_id, product_id, store, quantity, purchased_at, refunded, points, updated_at FROM commerce_transactions;
DROP TABLE commerce_transactions;
ALTER TABLE commerce_transactions_v5 RENAME TO commerce_transactions;
CREATE TABLE commerce_lots (uid TEXT NOT NULL, environment TEXT NOT NULL, tx_key TEXT NOT NULL, remaining INTEGER NOT NULL CHECK(typeof(remaining) = 'integer' AND remaining BETWEEN 0 AND 9007199254740991), purchased_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), revoked INTEGER NOT NULL CHECK(revoked IN (0,1)), PRIMARY KEY(uid, environment, tx_key), FOREIGN KEY(uid, environment) REFERENCES commerce_wallets(uid, environment), FOREIGN KEY(tx_key) REFERENCES commerce_transactions(tx_key), CHECK(active = (remaining > 0 AND revoked = 0)), CHECK(revoked = 0 OR remaining = 0));
CREATE INDEX commerce_lots_fifo ON commerce_lots(uid, environment, active, purchased_at, tx_key);
INSERT INTO commerce_lots SELECT uid, environment, tx_key, remaining, purchased_at, active, revoked FROM commerce_lots_web_backup;
DROP TABLE commerce_lots_web_backup;
