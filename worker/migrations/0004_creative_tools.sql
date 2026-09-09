-- Preserve historical redemptions and their revive reservations while extending the tool constraint.
CREATE TABLE commerce_revive_reservations_tool_backup AS SELECT uid, environment, run_id, operation_id FROM commerce_revive_reservations;
DROP TABLE commerce_revive_reservations;
CREATE TABLE commerce_redemptions_expanded (uid TEXT NOT NULL, environment TEXT NOT NULL, operation_id TEXT NOT NULL, run_id TEXT NOT NULL, tool TEXT NOT NULL CHECK(tool IN ('preview','teleport','revive','bounce','pin','velcro','sail','needle','stitch')), expected_cost INTEGER NOT NULL, context_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ready','applied','refunded')), allocations TEXT NOT NULL CHECK(json_valid(allocations)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT, PRIMARY KEY(uid, environment, operation_id), FOREIGN KEY(uid, environment) REFERENCES commerce_wallets(uid, environment));
INSERT INTO commerce_redemptions_expanded SELECT uid, environment, operation_id, run_id, tool, expected_cost, context_key, status, allocations, created_at, resolved_at FROM commerce_redemptions;
DROP TABLE commerce_redemptions;
ALTER TABLE commerce_redemptions_expanded RENAME TO commerce_redemptions;
CREATE TABLE commerce_revive_reservations (uid TEXT NOT NULL, environment TEXT NOT NULL, run_id TEXT NOT NULL, operation_id TEXT NOT NULL, PRIMARY KEY(uid, environment, run_id), FOREIGN KEY(uid, environment, operation_id) REFERENCES commerce_redemptions(uid, environment, operation_id));
INSERT INTO commerce_revive_reservations SELECT uid, environment, run_id, operation_id FROM commerce_revive_reservations_tool_backup;
DROP TABLE commerce_revive_reservations_tool_backup;
