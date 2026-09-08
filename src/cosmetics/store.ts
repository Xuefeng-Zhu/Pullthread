import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { CommerceError } from '../services/commerce/errors';
import { useCommerceStore } from '../store/useCommerceStore';
import { ORIGINAL, ownedAppearance, partById, type ButtonAppearance, type CosmeticAccount, type CosmeticPurchase, type CosmeticService } from './catalog';
import { cosmeticService } from './service';

type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem' | 'removeItem'>;
interface CollectionState {
  appearance: ButtonAppearance; owned: readonly string[]; busy: boolean; error: string; ready: boolean; pending: boolean;
  initialize(): Promise<void>; buy(id: string): Promise<void>; equip(look: ButtonAppearance): Promise<void>;
}
export function createCollectionStore(service: CosmeticService, storage: Storage) {
  let key = ''; let identity: Awaited<ReturnType<CosmeticService['identity']>> | null = null;
  let pending: CosmeticPurchase | null = null;
  const message = (error: unknown) => error instanceof Error ? error.message : 'Could not save your collection. Please retry.';
  return create<CollectionState>((set, get) => {
    const save = (owned: readonly string[], appearance: ButtonAppearance) => storage.setItem(key, JSON.stringify({ owned, appearance }));
    const accept = async (account: CosmeticAccount) => {
      if (account.uid !== identity?.uid || account.environment !== identity.environment) throw new Error('Your guest account changed. Reopen the studio.');
      const appearance = ownedAppearance(get().appearance, account.owned);
      await save(account.owned, appearance);
      set({ owned: account.owned, appearance, ready: true });
      useCommerceStore.getState().acceptWallet(account.wallet);
    };
    const settle = async () => {
      if (!pending) return;
      try {
        await accept(await service.purchase(pending));
        await storage.removeItem(`${key}.pending`);
        pending = null; set({ pending: false });
      } catch (error) {
        if (error instanceof CommerceError && error.code === 'insufficient_points' && error.operationId === pending?.operationId) {
          await storage.removeItem(`${key}.pending`); pending = null; set({ pending: false });
        }
        throw error;
      }
    };
    return {
      appearance: ORIGINAL, owned: [], busy: false, error: '', ready: false, pending: false,
      initialize: async () => {
        if (get().busy) return;
        set({ busy: true, error: '' });
        try {
          const next = await service.identity();
          const nextKey = `pullthread.cosmetics.v1.${next.environment}.${encodeURIComponent(next.uid)}`;
          if (key !== nextKey) {
            key = nextKey; identity = next; pending = null;
            set({ appearance: ORIGINAL, owned: [], ready: false, pending: false });
            const raw = await storage.getItem(key);
            if (raw) {
              try {
                const cached = JSON.parse(raw);
                const owned = Array.isArray(cached.owned) ? cached.owned.filter((id: unknown): id is string => typeof id === 'string' && !!partById(id)?.price) : [];
                set({ owned, appearance: ownedAppearance(cached.appearance, owned) });
              } catch { /* A damaged cache falls back to free parts. */ }
            }
          }
          const rawPending = await storage.getItem(`${key}.pending`);
          if (rawPending) {
            const saved = JSON.parse(rawPending) as CosmeticPurchase;
            if (typeof saved.operationId !== 'string' || saved.expectedPrice !== partById(saved.itemId)?.price || !saved.expectedPrice) throw new Error('A saved purchase needs recovery.');
            pending = saved; set({ pending: true });
          }
          await settle();
          await accept(await service.account());
        } catch (error) { set({ error: message(error), ready: false }); }
        finally { set({ busy: false }); }
      },
      buy: async id => {
        if (get().busy || !get().ready || !key) return;
        set({ busy: true, error: '' });
        try {
          if (pending) { await settle(); return; }
          const part = partById(id);
          if (!part?.price || get().owned.includes(id)) return;
          const request = { operationId: `cosmetic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`, itemId: id, expectedPrice: part.price };
          await storage.setItem(`${key}.pending`, JSON.stringify(request));
          pending = request; set({ pending: true });
          await settle();
        } catch (error) { set({ error: message(error) }); }
        finally { set({ busy: false }); }
      },
      equip: async look => {
        if (get().busy) return;
        set({ busy: true, error: '' });
        try {
          const appearance = ownedAppearance(look, get().owned);
          if ((['color', 'rim', 'pattern'] as const).some(category => appearance[category] !== look[category])) throw new Error('Unlock every selected part before equipping.');
          if (key) await save(get().owned, appearance);
          set({ appearance });
        } catch (error) { set({ error: message(error) }); }
        finally { set({ busy: false }); }
      },
    };
  });
}
export const useCollectionStore = createCollectionStore(cosmeticService, AsyncStorage);
