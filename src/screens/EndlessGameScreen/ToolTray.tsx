import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ToolKind } from '../../commerce/contracts';
import { TOOL_DESCRIPTIONS, TOOL_LABELS } from '../../commerce/toolCatalog';
import { ToolIcon } from '../../components/ToolIcon';

export function ToolTray({ inventory, previewActive, reviveUsed, phase, disabled, highContrast, onTool }: {
  inventory: Readonly<Record<ToolKind, number>>; previewActive: boolean; reviveUsed: boolean;
  phase: string; disabled: boolean; highContrast: boolean; onTool: (kind: ToolKind) => void;
}) {
  return <View testID="launch-tool-tray" style={styles.tray}>
    {(['preview', 'teleport', 'revive'] as const).map((kind) => {
      const unavailable = disabled || (kind === 'preview' && (phase !== 'held' || previewActive))
        || (kind === 'revive' && (phase !== 'failed' || reviveUsed)) || (kind === 'teleport' && phase === 'failed');
      const ready = kind === 'preview' && previewActive;
      const used = kind === 'revive' && reviveUsed;
      const detail = ready ? ', ready for your next launch' : used ? ', used this run' : '';
      return <Pressable key={kind} testID={`tool-${kind}`} disabled={unavailable}
        accessibilityRole="button" accessibilityState={{ disabled: unavailable }}
        accessibilityLabel={`${TOOL_LABELS[kind]}, ${inventory[kind]} free${detail}${kind === 'revive' ? ', available after falling, once per run' : ''}`}
        accessibilityHint={TOOL_DESCRIPTIONS[kind]}
        onPress={() => onTool(kind)} style={({ pressed }) => [styles.tool, highContrast && styles.contrast,
          unavailable && styles.disabled, pressed && styles.pressed, ready && styles.armed]}>
        <ToolIcon kind={kind} size={26} color="#244b45" />
        {(ready || used || inventory[kind] > 0) && <View pointerEvents="none" accessible={false}
          style={[styles.badge, highContrast && styles.contrast, ready && styles.readyBadge]}>
          {ready || used ? <Ionicons name={ready ? 'checkmark' : 'remove'} size={12} color={ready ? '#fff8e7' : '#244b45'} />
            : <Text accessible={false} maxFontSizeMultiplier={1.5} style={styles.count}>{inventory[kind] > 99 ? '99+' : inventory[kind]}</Text>}
        </View>}
      </Pressable>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  tray: { flexDirection: 'row', gap: 8, alignSelf: 'flex-end', paddingTop: 3 },
  tool: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: 24, backgroundColor: '#fff8e7', borderWidth: 1, borderColor: '#c3b695' },
  contrast: { backgroundColor: '#fffdf5', borderColor: '#244b45' },
  disabled: { opacity: 0.64 }, armed: { backgroundColor: '#dce9cf', opacity: 1 }, pressed: { opacity: 0.8 },
  badge: { position: 'absolute', top: -3, right: -2, minWidth: 18, minHeight: 18, paddingHorizontal: 3,
    borderRadius: 10, borderWidth: 1, borderColor: '#c3b695', backgroundColor: '#fff8e7', alignItems: 'center', justifyContent: 'center' },
  readyBadge: { backgroundColor: '#28594b', borderColor: '#28594b' },
  count: { fontFamily: 'NunitoSans_800ExtraBold', color: '#244b45', fontSize: 10, lineHeight: 14 },
});
