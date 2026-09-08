import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { COSMETIC_CATALOG, partById, type ButtonAppearance, type CosmeticCategory } from '../../cosmetics/catalog';
import { useCollectionStore } from '../../cosmetics/store';
import { Traveler } from '../../game/rendering/Traveler';
import { useCommerceStore } from '../../store/useCommerceStore';
import { PointsShop } from './PointsShop';

function Sample({ look, highContrast }: { look: ButtonAppearance; highContrast: boolean }) {
  const x = useSharedValue(90); const y = useSharedValue(85); const speed = useSharedValue(0);
  return <Canvas style={{ width: 180, height: 180 }} accessibilityLabel="Selected button preview">
    <Traveler appearance={look} x={x} y={y} speed={speed} radius={62} highContrast={highContrast} />
  </Canvas>;
}
export function ButtonStudio({ onClose, highContrast = false }: { onClose(): void; highContrast?: boolean }) {
  const insets = useSafeAreaInsets();
  const collection = useCollectionStore();
  const points = useCommerceStore(state => state.wallet?.points);
  const [draft, setLook] = useState<ButtonAppearance | null>(null);
  const look = draft ?? collection.appearance;
  const [category, setCategory] = useState<CosmeticCategory>('color');
  const [shop, setShop] = useState(false);
  useEffect(() => { void useCollectionStore.getState().initialize(); }, []);
  const selected = partById(look[category])!;
  const owned = (id: string) => !partById(id)?.price || collection.owned.includes(id);
  const canEquip = Object.values(look).every(owned);
  const equipped = Object.keys(look).every(key => look[key as CosmeticCategory] === collection.appearance[key as CosmeticCategory]);
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}><Text style={styles.actionText}>{label}</Text></Pressable>;
  return <Modal visible animationType="none" onRequestClose={() => { if (!collection.busy) onClose(); }}>
    <View style={[styles.page, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }, highContrast && { borderColor: '#172a24', borderWidth: 3 }]}>
      {shop ? <PointsShop onClose={() => { setShop(false); void collection.initialize(); }} /> : <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.eyebrow}>YOUR LITTLE SIGNATURE</Text><Text accessibilityRole="header" style={styles.title}>Button Studio</Text></View>{action('Close', onClose, collection.busy)}</View>
        <View style={styles.preview}><Sample look={look} highContrast={highContrast} /><Text style={styles.caption}>Made for your next leap.</Text><Text style={styles.balance}>{points ?? '—'} points</Text></View>
        <Text style={styles.copy}>Mix a color, a rim, and a little stitched detail. Yours to keep, with the same familiar flight.</Text>
        <View style={styles.tabs}>{(['color', 'rim', 'pattern'] as const).map(tab => <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: category === tab }} onPress={() => setCategory(tab)} style={[styles.tab, category === tab && styles.selectedTab]}><Text style={styles.tabText}>{tab[0].toUpperCase() + tab.slice(1)}</Text></Pressable>)}</View>
        <View style={styles.parts}>{COSMETIC_CATALOG.filter(part => part.category === category).map(part => <Pressable key={part.id} testID={`cosmetic-${part.id}`} accessibilityRole="button" accessibilityLabel={`${part.name}, ${owned(part.id) ? 'owned' : `${part.price} points`}`} accessibilityState={{ selected: look[category] === part.id }} onPress={() => { setLook({ ...look, [category]: part.id }); }} style={[styles.part, look[category] === part.id && styles.selectedPart]}>
          {part.category !== 'pattern' && <View style={[styles.swatch, { backgroundColor: part.value || '#639d88' }]} />}
          <Text style={styles.partName}>{part.name}</Text><Text style={styles.copy}>{collection.appearance[category] === part.id ? 'Equipped' : owned(part.id) ? 'Owned' : `${part.price} points`}</Text>
        </Pressable>)}</View>
        {!!collection.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{collection.error}</Text>}
        {collection.pending ? action(collection.busy ? 'Checking purchase…' : 'Recover purchase', () => void collection.initialize(), collection.busy)
          : !owned(selected.id) && action(`Buy ${category} · ${selected.price} points`, () => void collection.buy(selected.id), collection.busy || !collection.ready || (points ?? 0) < selected.price)}
        {action(equipped ? 'Look equipped' : 'Equip look', () => void collection.equip(look), !canEquip || equipped || collection.busy)}
        {!canEquip && <Text style={styles.copy}>Unlock the selected parts to equip this look.</Text>}
        {action('Get points', () => setShop(true), collection.busy)}
        {!collection.ready && action('Refresh collection', () => void collection.initialize(), collection.busy)}
        <Text style={styles.footnote}>Permanent parts belong to this guest account. Deleting the app or changing phones can lose access to your collection.</Text>
      </ScrollView>}
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5eddc', paddingTop: 48, paddingBottom: 24, paddingHorizontal: 16 },
  content: { gap: 16, paddingBottom: 24, maxWidth: 520, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 }, eyebrow: { fontSize: 10, letterSpacing: 1.8, color: '#6f6858', fontWeight: '700' },
  title: { fontSize: 30, fontWeight: '800', color: '#244b45' }, preview: { alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#9eaa8c', borderRadius: 24, paddingBottom: 16, backgroundColor: '#e8e6d0' },
  caption: { fontSize: 17, fontStyle: 'italic', color: '#244b45' }, balance: { fontSize: 22, fontWeight: '800', color: '#705521', marginTop: 12 },
  copy: { color: '#4b574a', fontSize: 14, lineHeight: 21 }, tabs: { flexDirection: 'row', gap: 6 }, tab: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderColor: '#d5ccba' }, selectedTab: { borderColor: '#28594b', backgroundColor: '#e3e7d5' }, tabText: { color: '#244b45', fontWeight: '700', fontSize: 16 },
  parts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, part: { flexGrow: 1, flexBasis: '44%', borderWidth: 2, borderColor: '#d9cfbc', borderRadius: 16, padding: 14, gap: 5, backgroundColor: '#fff9eb' }, selectedPart: { borderColor: '#28594b', backgroundColor: '#e7eddc' }, swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#4b574a' }, partName: { color: '#244b45', fontSize: 17, fontWeight: '700' },
  action: { backgroundColor: '#28594b', borderRadius: 14, padding: 14, minHeight: 48, alignItems: 'center' }, actionText: { color: '#fff9eb', fontWeight: '700', fontSize: 15 }, disabled: { opacity: 0.45 }, error: { color: '#87382a', fontSize: 14, lineHeight: 21 }, footnote: { color: '#665f50', fontSize: 12, lineHeight: 18 },
});
