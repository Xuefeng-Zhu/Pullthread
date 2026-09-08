import type { CommerceEnvironment, CommerceWallet } from '../commerce/contracts';

export type CosmeticCategory = 'color' | 'rim' | 'pattern';
export interface CosmeticPart { readonly id: string; readonly category: CosmeticCategory; readonly name: string; readonly price: number; readonly value: string }
export interface ButtonAppearance { readonly color: string; readonly rim: string; readonly pattern: string }
export const ORIGINAL: ButtonAppearance = { color: 'color-original', rim: 'rim-original', pattern: 'pattern-original' };
export const COSMETIC_CATALOG: readonly CosmeticPart[] = [
  { id: ORIGINAL.color, category: 'color', name: 'Original', price: 0, value: '' },
  ...[['Coral', '#d97965'], ['Sky', '#81bcd0'], ['Lavender', '#b39dcc'], ['Sunflower', '#e9b948'], ['Cream', '#eee1c6'], ['Midnight', '#39465e']].map(([name, value]) => ({ id: `color-${name.toLowerCase()}`, category: 'color' as const, name, value, price: 25 })),
  { id: ORIGINAL.rim, category: 'rim', name: 'Original', price: 0, value: '' },
  ...[['Brass', '#b58a38'], ['Pearl', '#f5eee0'], ['Scalloped', '#507968']].map(([name, value]) => ({ id: `rim-${name.toLowerCase()}`, category: 'rim' as const, name, value, price: 50 })),
  { id: ORIGINAL.pattern, category: 'pattern', name: 'Plain', price: 0, value: '' },
  ...['Cross-stitch', 'Daisies', 'Stars'].map(name => ({ id: `pattern-${name.toLowerCase()}`, category: 'pattern' as const, name, value: name, price: 75 })),
];
export const partById = (id: string) => COSMETIC_CATALOG.find(part => part.id === id);
export function ownedAppearance(value: Partial<ButtonAppearance> | null | undefined, owned: readonly string[]): ButtonAppearance {
  const selected = { ...ORIGINAL };
  for (const category of ['color', 'rim', 'pattern'] as const) {
    const part = partById(value?.[category] ?? '');
    if (part?.category === category && (!part.price || owned.includes(part.id))) selected[category] = part.id;
  }
  return selected;
}
export interface CosmeticPurchase { readonly operationId: string; readonly itemId: string; readonly expectedPrice: number }
export interface CosmeticAccount { readonly uid: string; readonly environment: CommerceEnvironment; readonly owned: readonly string[]; readonly wallet: CommerceWallet }
export interface CosmeticService {
  identity(): Promise<{ uid: string; environment: CommerceEnvironment }>;
  account(): Promise<CosmeticAccount>;
  purchase(request: CosmeticPurchase): Promise<CosmeticAccount>;
}
