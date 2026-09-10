import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ToolKind } from '../../commerce/contracts';
import { TOOL_DESCRIPTIONS, TOOL_LABELS } from '../../commerce/toolCatalog';
import { ToolIcon } from '../../components/ToolIcon';
import { FREE_TOOL_CAPACITY } from '../../game/launch/toolInventory';

/** Queue order is the pickup order; prepared effects are displayed separately. */
export function FreeToolSlots({ queue, highContrast = false, testID = 'free-tool-slots', toolTestIDPrefix, onTool, isUnavailable, ordered = true }: {
  queue: readonly ToolKind[]; highContrast?: boolean; testID?: string;
  toolTestIDPrefix?: string;
  onTool?: (kind: ToolKind) => void; isUnavailable?: (kind: ToolKind) => boolean; ordered?: boolean;
}) {
  const full = queue.length === FREE_TOOL_CAPACITY;
  const description = (ordered ? `Free tools, ${queue.length} of ${FREE_TOOL_CAPACITY}.` : `Free pickup shortcuts, ${queue.length} shown.`)
    + (queue.length ? ` ${ordered ? 'Oldest to newest' : 'Shown pickups'}: ${queue.map(kind => TOOL_LABELS[kind]).join(', ')}.` : '')
    + (full && ordered ? ` The next pickup replaces ${TOOL_LABELS[queue[0]]}.` : '');
  return <View testID={testID} accessible={!onTool} accessibilityLabel={description} style={[styles.row, !!onTool && styles.interactiveRow]}>
    {!onTool && <Text accessible={false} style={styles.label}>Free {queue.length}/{FREE_TOOL_CAPACITY}</Text>}
    {Array.from({ length: FREE_TOOL_CAPACITY }, (_, index) => {
      const kind = queue[index];
      const unavailable = !!kind && !!isUnavailable?.(kind);
      const slotStyle: StyleProp<ViewStyle> = [styles.slot, !!onTool && styles.interactiveSlot, !kind && styles.empty,
        highContrast && styles.contrast, full && ordered && index === 0 && styles.oldest];
      return <View key={index} testID={`${testID}-${index}`}>
        {kind && onTool ? <Pressable testID={toolTestIDPrefix ? `${toolTestIDPrefix}-${kind}` : `tool-${kind}`} accessibilityRole="button"
          accessibilityLabel={`${TOOL_LABELS[kind]}, free pickup ${index + 1}${ordered && full && index === 0 ? ', oldest, replaced by the next pickup' : ''}`}
          accessibilityHint={TOOL_DESCRIPTIONS[kind]} accessibilityState={{ disabled: unavailable }} disabled={unavailable}
          onPress={() => onTool(kind)} style={({ pressed }) => [slotStyle, unavailable && styles.disabled, pressed && styles.pressed]}>
          <ToolIcon kind={kind} size={26} color="#244b45" />
        </Pressable> : <View accessible={false} style={slotStyle}>
          {kind && <ToolIcon kind={kind} size={16} color="#244b45" />}
        </View>}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#fff8e7' },
  label: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, lineHeight: 16, color: '#244b45', marginRight: 3 },
  interactiveRow: { gap: 8, marginTop: 0, paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent' },
  interactiveSlot: { width: 48, height: 48, borderRadius: 16 },
  disabled: { opacity: 0.64 }, pressed: { opacity: 0.8 },
  slot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 8,
    borderWidth: 1, borderColor: '#8ba48c', backgroundColor: '#dce9cf' },
  empty: { backgroundColor: '#fff8e7', borderStyle: 'dashed', borderColor: '#a99d7e' },
  oldest: { borderWidth: 2, borderColor: '#28594b' },
  contrast: { borderColor: '#244b45' },
});
