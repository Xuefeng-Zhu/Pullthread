import { StyleSheet, Text, View } from 'react-native';
import type { ToolKind } from '../../commerce/contracts';
import { TOOL_LABELS } from '../../commerce/toolCatalog';
import { ToolIcon } from '../../components/ToolIcon';
import { FREE_TOOL_CAPACITY } from '../../game/launch/toolInventory';

/** Queue order is the pickup order; prepared effects are displayed separately. */
export function FreeToolSlots({ queue, highContrast = false, testID = 'free-tool-slots' }: {
  queue: readonly ToolKind[]; highContrast?: boolean; testID?: string;
}) {
  const full = queue.length === FREE_TOOL_CAPACITY;
  const description = `Free tools, ${queue.length} of ${FREE_TOOL_CAPACITY}.`
    + (queue.length ? ` Oldest to newest: ${queue.map(kind => TOOL_LABELS[kind]).join(', ')}.` : '')
    + (full ? ` The next pickup replaces ${TOOL_LABELS[queue[0]]}.` : '');
  return <View testID={testID} accessible accessibilityLabel={description} style={styles.row}>
    <Text accessible={false} style={styles.label}>Free {queue.length}/{FREE_TOOL_CAPACITY}</Text>
    {Array.from({ length: FREE_TOOL_CAPACITY }, (_, index) => <View key={index} testID={`${testID}-${index}`}
      accessible={false} style={[styles.slot, highContrast && styles.contrast, !queue[index] && styles.empty, full && index === 0 && styles.oldest]}>
      {queue[index] && <ToolIcon kind={queue[index]} size={16} color="#244b45" />}
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end', marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: '#fff8e7' },
  label: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, lineHeight: 16, color: '#244b45', marginRight: 3 },
  slot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 8,
    borderWidth: 1, borderColor: '#8ba48c', backgroundColor: '#dce9cf' },
  empty: { backgroundColor: '#fff8e7', borderStyle: 'dashed', borderColor: '#a99d7e' },
  oldest: { borderWidth: 2, borderColor: '#28594b' },
  contrast: { borderColor: '#244b45' },
});
