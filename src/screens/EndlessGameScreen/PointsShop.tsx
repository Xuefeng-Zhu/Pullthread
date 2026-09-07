import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TOOL_COSTS } from '../../commerce/contracts';
import { useCommerceStore } from '../../store/useCommerceStore';

const DISCLOSURE_KEY = 'pullthread.points-guest-disclosure.v1';

export function PointsShop({ onClose }: { onClose: () => void }) {
  const commerce = useCommerceStore();
  const [accepted, setAccepted] = useState(false);
  const [checking, setChecking] = useState(true);
  const purchaseLock = useRef(false);
  const [purchasing, setPurchasing] = useState(false);
  const [localError, setLocalError] = useState('');
  const busy = commerce.busy || purchasing;
  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(DISCLOSURE_KEY).then((value) => { if (mounted) setAccepted(value === 'accepted'); })
      .catch(() => undefined).finally(() => { if (mounted) setChecking(false); });
    return () => { mounted = false; };
  }, []);
  const buy = async (productId: string) => {
    if (!accepted || checking || commerce.busy || purchaseLock.current) return;
    purchaseLock.current = true;
    setPurchasing(true); setLocalError('');
    try {
      // A successful durable disclosure acknowledgement precedes checkout.
      await AsyncStorage.setItem(DISCLOSURE_KEY, 'accepted');
      await commerce.purchasePoints(productId);
    } catch {
      setLocalError(useCommerceStore.getState().error || 'The purchase could not start. Please check your connection and available device storage, then try again.');
    } finally { purchaseLock.current = false; setPurchasing(false); }
  };
  const enabled = commerce.status === 'ready';

  return <View testID="points-shop" style={styles.sheet} accessibilityViewIsModal>
    <View style={styles.header}>
      <View><Text style={styles.eyebrow}>A LITTLE HELP FOR THE CLIMB</Text><Text accessibilityRole="header" style={styles.title}>Points & tools</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Close points shop" testID="points-shop-close"
        onPress={() => { if (!purchaseLock.current && !commerce.busy) onClose(); }} disabled={busy} style={styles.close}>
        <Ionicons name="close" size={23} color="#244b45" />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.balance}><Ionicons name="sparkles-outline" size={24} color="#875e14" />
        <Text testID="points-shop-balance" style={styles.balanceText}>{commerce.wallet?.points ?? '—'} points</Text>
        {commerce.mode === 'mock' && <Text style={styles.demo}>DEMO</Text>}
      </View>
      <Text style={styles.copy}>Catch stitched tokens to earn free tools for this run. Points let you buy an extra use when you need it.</Text>
      <Text style={styles.prices}>Preview {TOOL_COSTS.preview} · Land {TOOL_COSTS.teleport} · Revive {TOOL_COSTS.revive} points</Text>
      {commerce.mode === 'mock' && <Text style={styles.notice}>Demo wallet. No real purchases or money.</Text>}
      {commerce.status === 'loading' && <ActivityIndicator color="#28594b" accessibilityLabel="Loading points shop" />}
      {!enabled && commerce.status !== 'loading' && <View style={styles.noticeBox}>
        <Text style={styles.noticeTitle}>Points shop unavailable</Text>
        <Text style={styles.copy}>{commerce.error || 'Points purchases will be available in a configured iPhone or Android build. Free pickups and tools are ready to play.'}</Text>
      </View>}
      {enabled && <>
        <Pressable testID="points-guest-disclosure" accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}
          disabled={busy} onPress={() => setAccepted((value) => !value)} style={styles.disclosure}>
          <Ionicons name={accepted ? 'checkbox' : 'square-outline'} size={25} color="#28594b" />
          <Text style={styles.disclosureText}>I understand: my points stay on this installation. Deleting the app or changing phones can lose this guest wallet. Restore purchases cannot recover spent or consumable points.</Text>
        </Pressable>
        {commerce.offers.map((offer) => <Pressable key={offer.productId} testID={`buy-${offer.productId}`}
          accessibilityRole="button" accessibilityLabel={`Buy ${offer.points} points for ${offer.priceLabel}`}
          disabled={!accepted || busy || checking} onPress={() => void buy(offer.productId)}
          style={({ pressed }) => [styles.pack, (!accepted || busy || checking) && styles.disabled, pressed && styles.pressed]}>
          <View><Text style={styles.packAmount}>{offer.points} points</Text><Text style={styles.packDetail}>One-time purchase</Text></View>
          <Text style={styles.packPrice}>{offer.priceLabel}</Text>
        </Pressable>)}
        {commerce.offers.length === 0 && <Text style={styles.copy}>No point packs are available right now.</Text>}
      </>}
      {busy && <ActivityIndicator color="#28594b" accessibilityLabel="Checking your purchase" />}
      {commerce.notice && <Text testID="points-shop-notice" accessibilityLiveRegion="polite" style={styles.notice}>{commerce.notice}</Text>}
      {commerce.error && enabled && <Text testID="points-shop-error" accessibilityLiveRegion="polite" style={styles.error}>{commerce.error}</Text>}
      {!!localError && <Text testID="points-shop-local-error" accessibilityLiveRegion="polite" style={styles.error}>{localError}</Text>}
      <Pressable testID="points-shop-refresh" accessibilityRole="button" disabled={busy}
        onPress={() => { void commerce.initialize(); }} style={styles.refresh}>
        <Text style={styles.refreshText}>Refresh points & purchases</Text>
      </Pressable>
      <Text style={styles.footnote}>Points carry over between runs. Free tools reset on a new run. Buying points never activates a tool automatically.</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  sheet: { width: '100%', maxWidth: 420, maxHeight: '100%', flexShrink: 1, backgroundColor: '#fff8e7', borderRadius: 24, borderWidth: 2, borderColor: '#bba980', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, paddingBottom: 12, gap: 4 },
  eyebrow: { color: '#73745a', fontFamily: 'NunitoSans_800ExtraBold', fontSize: 8, letterSpacing: 1 },
  title: { color: '#244b45', fontFamily: 'Fraunces_600SemiBold', fontSize: 26, marginTop: 3 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: '#eee5ce' },
  content: { padding: 18, paddingTop: 0, gap: 14 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 15, backgroundColor: '#f0e1b9' },
  balanceText: { color: '#62450f', fontFamily: 'Fraunces_600SemiBold', fontSize: 26, flex: 1 },
  demo: { fontFamily: 'NunitoSans_800ExtraBold', color: '#755116', fontSize: 10 },
  copy: { color: '#58614d', fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, lineHeight: 19 },
  prices: { color: '#315746', fontFamily: 'NunitoSans_800ExtraBold', fontSize: 12 },
  noticeBox: { backgroundColor: '#eee8d7', padding: 14, borderRadius: 14, gap: 5 },
  noticeTitle: { color: '#244b45', fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15 },
  notice: { color: '#315746', fontFamily: 'NunitoSans_700Bold', fontSize: 13, lineHeight: 19 },
  disclosure: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 5 },
  disclosureText: { flex: 1, fontFamily: 'NunitoSans_600SemiBold', color: '#5f614c', fontSize: 11, lineHeight: 17 },
  pack: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#bbab87', borderRadius: 14, padding: 14, backgroundColor: '#fffdf5' },
  packAmount: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 19, color: '#244b45' },
  packDetail: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 10, color: '#6c7055', marginTop: 2 },
  packPrice: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 16, color: '#fff8e7', backgroundColor: '#28594b', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  disabled: { opacity: 0.5 }, pressed: { opacity: 0.75 },
  refresh: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#c3b695', borderRadius: 12 },
  refreshText: { fontFamily: 'NunitoSans_800ExtraBold', color: '#28594b', fontSize: 12 },
  footnote: { color: '#73745a', fontFamily: 'NunitoSans_600SemiBold', fontSize: 11, lineHeight: 17 },
  error: { color: '#933f4b', fontFamily: 'NunitoSans_700Bold', fontSize: 13, lineHeight: 19 },
});
