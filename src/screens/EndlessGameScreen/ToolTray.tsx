import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ToolKind } from '../../commerce/contracts';
import { TOOL_ICONS, TOOL_LABELS } from '../../commerce/toolCatalog';

export function ToolTray({ inventory, previewActive, reviveUsed, phase, disabled, highContrast, onTool }: {
  inventory: Readonly<Record<ToolKind, number>>; previewActive: boolean; reviveUsed: boolean;
  phase: string; disabled: boolean; highContrast: boolean; onTool: (kind: ToolKind) => void;
}) {
  return <View testID="launch-tool-tray" style={styles.tray}>
    {(['preview', 'teleport', 'revive'] as const).map((kind) => {
      const unavailable = disabled || (kind === 'preview' && (phase !== 'held' || previewActive))
        || (kind === 'revive' && (phase !== 'failed' || reviveUsed)) || (kind === 'teleport' && phase === 'failed');
      const detail = kind === 'preview' && previewActive ? 'Ready'
        : kind === 'revive' && reviveUsed ? 'Used' : inventory[kind] > 0 ? `${inventory[kind]} free` : '+';
      return <Pressable key={kind} testID={`tool-${kind}`} disabled={unavailable}
        accessibilityRole="button" accessibilityState={{ disabled: unavailable }}
        accessibilityLabel={`${TOOL_LABELS[kind]}, ${inventory[kind]} free${kind === 'revive' ? ', available after falling, once per run' : ''}`}
        onPress={() => onTool(kind)} style={({ pressed }) => [styles.tool, highContrast && styles.contrast,
          unavailable && styles.disabled, pressed && styles.pressed, kind === 'preview' && previewActive && styles.armed]}>
        <Ionicons name={TOOL_ICONS[kind]} size={20} color="#244b45" />
        <View><Text style={styles.name}>{TOOL_LABELS[kind]}</Text><Text style={styles.count}>{detail}</Text></View>
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  tray: { flexDirection: 'row', gap: 6, alignSelf: 'center', width: '100%', maxWidth: 360 },
  tool: { flex: 1, minHeight: 46, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingVertical: 5,
    paddingHorizontal: 7, borderRadius: 14, backgroundColor: '#fff8e7', borderWidth: 1, borderColor: '#c3b695' },
  contrast: { backgroundColor: '#fffdf5', borderColor: '#244b45' },
  disabled: { opacity: 0.64 }, armed: { backgroundColor: '#dce9cf', opacity: 1 }, pressed: { opacity: 0.8 },
  name: { fontFamily: 'NunitoSans_800ExtraBold', color: '#244b45', fontSize: 11 },
  count: { fontFamily: 'NunitoSans_700Bold', color: '#5e634c', fontSize: 10 },
});
