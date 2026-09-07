/** Shared catalog and wire contracts. Wallet authority lives on the server. */
export type ToolKind = 'preview' | 'teleport' | 'revive';
export type CommerceEnvironment = 'sandbox' | 'production';

export const TOOL_COSTS: Readonly<Record<ToolKind, number>> = {
  preview: 10, teleport: 25, revive: 50,
};
export const POINT_PACKS = [
  { productId: 'pullthread_points_100', points: 100 },
  { productId: 'pullthread_points_550', points: 550 },
  { productId: 'pullthread_points_1200', points: 1200 },
] as const;

export interface PointOffer {
  readonly productId: string;
  readonly points: number;
  readonly priceLabel: string;
}
export interface CommerceWallet {
  readonly points: number;
  readonly revision: number;
  readonly environment: CommerceEnvironment;
}
export interface PurchaseQuery {
  readonly transactionId: string;
  readonly productId: string;
}
/** A query is matched against provider-verified transactions; it never grants credit. */
export interface CommerceWalletSyncResult {
  readonly wallet: CommerceWallet;
  readonly purchase?: PurchaseQuery & { readonly verified: boolean };
}
export interface RedeemToolRequest {
  readonly operationId: string;
  readonly runId: string;
  readonly tool: ToolKind;
  readonly expectedCost: number;
  /** Binds an operation to the frozen tick and selected destination, if any. */
  readonly contextKey: string;
}
export interface ToolReceipt extends RedeemToolRequest {
  readonly status: 'ready' | 'applied' | 'refunded';
}
export interface RedemptionResult {
  readonly wallet: CommerceWallet;
  readonly receipt: ToolReceipt;
}
export type ResolveToolAction = 'applied' | 'refund';

export interface CommerceService {
  readonly mode: 'native' | 'unavailable' | 'mock';
  readonly environment: CommerceEnvironment;
  readonly unavailableReason?: string;
  getAccountId(): Promise<string>;
  getOffers(): Promise<readonly PointOffer[]>;
  getWallet(): Promise<CommerceWallet>;
  /** Store completion never directly grants points; reconciliation verifies it. */
  purchasePoints(productId: string): Promise<{ readonly status: 'verified' | 'pending' | 'cancelled'; readonly wallet: CommerceWallet }>;
  redeemTool(request: RedeemToolRequest): Promise<RedemptionResult>;
  getRedemption(operationId: string): Promise<RedemptionResult | null>;
  resolveTool(operationId: string, action: ResolveToolAction): Promise<RedemptionResult>;
}
