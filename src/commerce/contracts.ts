/** Shared catalog and wire contracts. Wallet authority lives on the server. */
export const CREATIVE_TOOLS = ['bounce', 'pin', 'velcro', 'sail', 'needle', 'stitch'] as const;
export type CreativeToolKind = typeof CREATIVE_TOOLS[number];
export type ToolKind = 'preview' | 'teleport' | 'revive' | CreativeToolKind;
export const TOOL_KINDS = ['preview', 'teleport', 'revive', ...CREATIVE_TOOLS] as const;
export function isToolKind(value: unknown): value is ToolKind {
  return typeof value === 'string' && (TOOL_KINDS as readonly string[]).includes(value);
}
export function isCreativeTool(value: unknown): value is CreativeToolKind {
  return typeof value === 'string' && (CREATIVE_TOOLS as readonly string[]).includes(value);
}
export function emptyToolInventory(): Record<ToolKind, number> {
  return { preview: 0, teleport: 0, revive: 0, bounce: 0, pin: 0, velcro: 0, sail: 0, needle: 0, stitch: 0 };
}
export type CommerceEnvironment = 'sandbox' | 'production';

export const TOOL_COSTS: Readonly<Record<ToolKind, number>> = {
  preview: 10, teleport: 25, revive: 50,
  bounce: 15, pin: 15, velcro: 15, sail: 10, needle: 20, stitch: 20,
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
