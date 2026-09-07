import { POINT_PACKS, TOOL_COSTS, type CommerceEnvironment, type CommerceWallet, type RedemptionResult, type ToolReceipt } from '../../commerce/contracts';
import { CommerceError } from './errors';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }

export function requirePointPack(productId: string) {
  const pack = POINT_PACKS.find((item) => item.productId === productId);
  if (!pack) throw new CommerceError('This points pack is unavailable.', 'invalid');
  return pack;
}

export function readWallet(value: unknown, environment: CommerceEnvironment): CommerceWallet {
  if (!record(value) || !integer(value.points) || !integer(value.revision) || value.environment !== environment) {
    throw new CommerceError('We couldn’t verify this balance. Please refresh.', 'invalid');
  }
  return { points: value.points, revision: value.revision, environment };
}

export function readRedemption(value: unknown, environment: CommerceEnvironment, operationId: string): RedemptionResult {
  if (!record(value) || !record(value.receipt)) throw new CommerceError('We couldn’t verify this tool purchase.', 'invalid');
  const receipt = value.receipt;
  if (receipt.operationId !== operationId || typeof receipt.runId !== 'string' || !receipt.runId
    || typeof receipt.contextKey !== 'string' || !receipt.contextKey
    || (receipt.tool !== 'preview' && receipt.tool !== 'teleport' && receipt.tool !== 'revive')
    || receipt.expectedCost !== TOOL_COSTS[receipt.tool]
    || (receipt.status !== 'ready' && receipt.status !== 'applied' && receipt.status !== 'refunded')) {
    throw new CommerceError('We couldn’t verify this tool purchase.', 'invalid');
  }
  return { wallet: readWallet(value.wallet, environment), receipt: receipt as unknown as ToolReceipt };
}
