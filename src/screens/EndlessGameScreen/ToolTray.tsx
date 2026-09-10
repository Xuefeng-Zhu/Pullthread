import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TOOL_KINDS, type ToolKind } from '../../commerce/contracts';
import { TOOL_LABELS } from '../../commerce/toolCatalog';
import { FREE_TOOL_CAPACITY } from '../../game/launch/toolInventory';
import { FreeToolSlots } from './FreeToolSlots';
import { isToolUnavailable, type ToolAvailability } from './toolAvailability';

export function ToolTray({ inventory, previewActive, reviveUsed, phase, disabled, highContrast, onTool, onTools, preparedCount = 0, preparedTools = [], creativeEnabled = true, freeToolQueue }: ToolAvailability & {
  inventory: Readonly<Record<ToolKind, number>>; disabled: boolean; highContrast: boolean; onTool: (kind: ToolKind) => void;
  onTools?: () => void; preparedCount?: number; freeToolQueue?: readonly ToolKind[];
}) {
  const availability = { phase, previewActive, reviveUsed, preparedTools, creativeEnabled };
  // Historical runs retain their full inventory in the toolbox; only the quick slots are limited.
  const pickups = freeToolQueue ?? TOOL_KINDS.flatMap(kind => Array<ToolKind>(Math.min(inventory[kind], FREE_TOOL_CAPACITY)).fill(kind)).slice(0, FREE_TOOL_CAPACITY);
  return <View testID="launch-tool-tray" style={styles.wrapper}>
    <View style={styles.tray}>
      <FreeToolSlots queue={pickups} ordered={!!freeToolQueue} highContrast={highContrast} onTool={onTool}
        isUnavailable={kind => disabled || isToolUnavailable(kind, availability)} />
      <Pressable testID="tool-box" accessibilityRole="button" accessibilityLabel={`Tools, ${preparedCount} prepared`}
        accessibilityHint="Open all tools, free pickups, and point prices."
        accessibilityState={{ disabled }} disabled={disabled}
        onPress={onTools} style={({ pressed }) => [styles.tool, highContrast && styles.contrast, disabled && styles.disabled, pressed && styles.pressed]}>
        <Ionicons name="construct-outline" size={25} color="#244b45" />
        {preparedCount > 0 && <View style={styles.badge}><Text style={styles.count}>{preparedCount}</Text></View>}
      </Pressable>
    </View>
    {preparedTools.length > 0 && <Text testID="prepared-tools" numberOfLines={2} accessibilityLiveRegion="polite" style={styles.preparedText}>{phase === 'held' ? 'Ready: ' : 'In flight: '}{preparedTools.map(kind => TOOL_LABELS[kind]).join(' · ')}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'flex-end' },
  preparedText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 11, lineHeight: 16, color: '#244b45', textAlign: 'right', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: '#fff8e7', borderRadius: 10 },
  tray: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'flex-end', paddingTop: 3 },
  tool: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: 24, backgroundColor: '#fff8e7', borderWidth: 1, borderColor: '#c3b695' },
  contrast: { backgroundColor: '#fffdf5', borderColor: '#244b45' },
  disabled: { opacity: 0.64 }, pressed: { opacity: 0.8 },
  badge: { position: 'absolute', top: -3, right: -2, minWidth: 18, minHeight: 18, paddingHorizontal: 3,
    borderRadius: 10, backgroundColor: '#28594b', alignItems: 'center', justifyContent: 'center' },
  count: { fontFamily: 'NunitoSans_800ExtraBold', color: '#fff8e7', fontSize: 10, lineHeight: 14 },
});
