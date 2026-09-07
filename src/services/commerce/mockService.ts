import { POINT_PACKS, TOOL_COSTS, type CommerceService, type CommerceWallet, type ToolReceipt } from '../../commerce/contracts';
import { CommerceError } from './errors';
import { requirePointPack } from './validation';

/** Deliberately ephemeral and separate from every authenticated wallet. */
export function createMockCommerceService(): CommerceService {
  let wallet: CommerceWallet = { environment: 'sandbox', points: 0, revision: 0 };
  const receipts = new Map<string, ToolReceipt>();
  const result = (receipt: ToolReceipt) => ({ wallet: { ...wallet }, receipt: { ...receipt } });
  return {
    mode: 'mock', environment: 'sandbox',
    getAccountId: async () => 'mock:sandbox:pullthread',
    getOffers: async () => POINT_PACKS.map((pack) => ({ ...pack, priceLabel: 'Demo · no charge' })),
    getWallet: async () => ({ ...wallet }),
    purchasePoints: async (productId) => {
      const pack = requirePointPack(productId);
      wallet = { ...wallet, points: wallet.points + pack.points, revision: wallet.revision + 1 };
      return { status: 'verified', wallet: { ...wallet } };
    },
    redeemTool: async (request) => {
      const previous = receipts.get(request.operationId);
      if (previous) {
        if (previous.runId !== request.runId || previous.tool !== request.tool || previous.contextKey !== request.contextKey
          || previous.expectedCost !== request.expectedCost) throw new CommerceError('This action already has a different receipt.', 'invalid');
        return result(previous);
      }
      if (request.expectedCost !== TOOL_COSTS[request.tool]) throw new CommerceError('This tool price has changed.', 'invalid');
      if (wallet.points < request.expectedCost) throw new CommerceError('You need more demo points for this tool.', 'insufficient_points', request.operationId);
      wallet = { ...wallet, points: wallet.points - request.expectedCost, revision: wallet.revision + 1 };
      const receipt: ToolReceipt = { ...request, status: 'ready' };
      receipts.set(request.operationId, receipt);
      return result(receipt);
    },
    getRedemption: async (operationId) => {
      const receipt = receipts.get(operationId);
      return receipt ? result(receipt) : null;
    },
    resolveTool: async (operationId, action) => {
      const previous = receipts.get(operationId);
      if (!previous) throw new CommerceError('This demo receipt is unavailable.', 'invalid');
      if (previous.status !== 'ready') return result(previous);
      const receipt: ToolReceipt = { ...previous, status: action === 'applied' ? 'applied' : 'refunded' };
      if (action === 'refund') wallet = { ...wallet, points: wallet.points + previous.expectedCost, revision: wallet.revision + 1 };
      receipts.set(operationId, receipt);
      return result(receipt);
    },
  };
}
