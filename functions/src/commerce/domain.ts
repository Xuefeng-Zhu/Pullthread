import { createHash } from 'node:crypto';
import { isToolKind, POINT_PACKS, TOOL_COSTS, type CommerceEnvironment, type RedeemToolRequest, type ToolReceipt } from '../../../src/commerce/contracts';

export class CommerceError extends Error {
  constructor(readonly code: 'invalid-argument' | 'failed-precondition' | 'permission-denied' | 'not-found' | 'already-exists' | 'resource-exhausted' | 'unavailable', message: string, readonly details?: { reason: 'insufficient_points'; operationId: string }) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CommerceError('invalid-argument', 'Expected an object.');
  return value as Record<string, unknown>;
}
export function environment(value: unknown): CommerceEnvironment {
  if (value !== 'sandbox' && value !== 'production') throw new CommerceError('invalid-argument', 'Invalid commerce environment.');
  return value;
}
export function identifier(value: unknown, label = 'identifier'): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new CommerceError('invalid-argument', `Invalid ${label}.`);
  return value;
}
export function parseRedemption(value: unknown): RedeemToolRequest {
  const data = object(value);
  const operationId = identifier(data.operationId, 'operation ID');
  const runId = identifier(data.runId, 'run ID');
  if (!isToolKind(data.tool)) throw new CommerceError('invalid-argument', 'Unknown tool.');
  if (data.expectedCost !== TOOL_COSTS[data.tool]) throw new CommerceError('failed-precondition', 'The tool price changed. Refresh before buying.');
  if (typeof data.contextKey !== 'string' || data.contextKey.length < 1 || data.contextKey.length > 512) throw new CommerceError('invalid-argument', 'Invalid tool context.');
  return { operationId, runId, tool: data.tool, expectedCost: TOOL_COSTS[data.tool], contextKey: data.contextKey };
}
export function sameRequest(receipt: ToolReceipt, request: RedeemToolRequest): boolean {
  return receipt.operationId === request.operationId && receipt.runId === request.runId && receipt.tool === request.tool
    && receipt.expectedCost === request.expectedCost && receipt.contextKey === request.contextKey;
}
export function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
export interface VerifiedPurchase {
  readonly transactionId: string;
  readonly productId: string;
  readonly store: 'app_store' | 'play_store' | 'rc_billing' | 'stripe' | 'paddle' | 'test_store';
  readonly environment: CommerceEnvironment;
  readonly purchasedAt: number;
  readonly quantity: number;
  readonly refunded: boolean;
}
export function packPoints(purchase: VerifiedPurchase): number {
  const pack = POINT_PACKS.find((item) => item.productId === purchase.productId);
  if (!pack || !Number.isSafeInteger(purchase.quantity) || purchase.quantity < 1 || purchase.quantity > 100
    || !Number.isSafeInteger(purchase.purchasedAt) || purchase.purchasedAt < 0
    || typeof purchase.transactionId !== 'string' || purchase.transactionId.length < 1 || purchase.transactionId.length > 512
    || !['app_store', 'play_store', 'rc_billing', 'stripe', 'paddle', 'test_store'].includes(purchase.store)
    || (purchase.store === 'test_store' && purchase.environment !== 'sandbox')) {
    throw new CommerceError('invalid-argument', 'Invalid verified point purchase.');
  }
  environment(purchase.environment);
  return pack.points * purchase.quantity;
}
export function transactionKey(purchase: VerifiedPurchase): string {
  return `${purchase.environment}_${hash(`${purchase.store}:${purchase.transactionId}`)}`;
}
