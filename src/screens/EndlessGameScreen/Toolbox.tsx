import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { TOOL_KINDS, TOOL_COSTS, isCreativeTool, type CreativeToolKind, type ToolKind } from '../../commerce/contracts';
import type { ToolUse } from '../../commerce/toolUse';
import { TOOL_DESCRIPTIONS, TOOL_LABELS } from '../../commerce/toolCatalog';
import { ToolIcon } from '../../components/ToolIcon';
import { FreeToolSlots } from './FreeToolSlots';
import type { LaunchPoint } from '../../game/launch/types';
import { isToolUnavailable, type ToolAvailability } from './toolAvailability';

export interface ToolSetupData {
  cameraY: number;
  targets: readonly { id: string; x: number; y: number; width: number; label: string }[];
  placements: readonly LaunchPoint[];
  position: LaunchPoint;
}

export function Toolbox({ inventory, prepared, freeToolQueue, availability, onChoose, onClose }: {
  inventory: Readonly<Record<ToolKind, number>>; prepared: readonly ToolKind[]; freeToolQueue?: readonly ToolKind[];
  availability: ToolAvailability; onChoose: (kind: ToolKind) => void; onClose: () => void;
}) {
  return <View testID="toolbox" style={styles.toolbox} accessibilityViewIsModal>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Tools</Text>
      <Pressable testID="toolbox-close" accessibilityRole="button" onPress={onClose} style={styles.button}><Text style={styles.buttonText}>Close</Text></Pressable></View>
    <Text style={styles.copy}>Use a free pickup or spend points. Combine different trick shot tools before you pull.</Text>
    {freeToolQueue && <>
      <FreeToolSlots queue={freeToolQueue} testID="toolbox-free-slots" />
      <Text style={styles.small}>Oldest on the left. When full, a pickup replaces your oldest free tool.</Text>
    </>}
    <ScrollView testID="toolbox-scroll" contentContainerStyle={styles.cards}>
      {TOOL_KINDS.filter(kind => availability.creativeEnabled !== false || !isCreativeTool(kind)).map((kind) => {
        const ready = prepared.includes(kind) || kind === 'preview' && availability.previewActive;
        const unavailable = isToolUnavailable(kind, availability);
        const status = ready ? '✓ Prepared' : kind === 'revive' && availability.reviveUsed ? 'Used this run'
          : kind === 'revive' && availability.phase !== 'failed' ? 'After falling' : undefined;
        return <Pressable key={kind} testID={`toolbox-${kind}`} disabled={unavailable}
        accessibilityRole="button" accessibilityState={{ disabled: unavailable }}
        accessibilityLabel={`${TOOL_LABELS[kind]}, ${inventory[kind] ?? 0} free, ${TOOL_COSTS[kind]} points${status ? `, ${status}` : ''}`}
        onPress={() => onChoose(kind)} style={[styles.card, ready && styles.prepared, unavailable && styles.unavailable]}>
        <ToolIcon kind={kind} size={30} />
        <Text style={styles.cardTitle}>{TOOL_LABELS[kind]}</Text>
        <Text style={styles.cardCopy}>{TOOL_DESCRIPTIONS[kind]}</Text>
        <Text style={styles.price}>{`${inventory[kind] ?? 0} free · ${TOOL_COSTS[kind]} points`}{status ? ` · ${status}` : ''}</Text>
      </Pressable>; })}
    </ScrollView>
  </View>;
}

function Adjustment({ label, value, onDecrease, onIncrease }: {
  label: string; value: number; onDecrease: () => void; onIncrease: () => void;
}) {
  return <View style={styles.adjustment}>
    <Text style={styles.small}>{label}: {value}</Text>
    <View style={styles.row}>
      <Pressable testID={`tool-${label.toLowerCase()}-decrease`} accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={onDecrease} style={styles.adjustButton}><Text style={styles.buttonText}>−</Text></Pressable>
      <Pressable testID={`tool-${label.toLowerCase()}-increase`} accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={onIncrease} style={styles.adjustButton}><Text style={styles.buttonText}>＋</Text></Pressable>
    </View>
  </View>;
}

export function ToolSetup({ kind, data, draft, projection, free, points, commerceReady, busy, error, validate, placement, onConfirm, onCancel, onGetPoints }: {
  kind: CreativeToolKind; data: ToolSetupData; draft?: ToolUse;
  projection: { scale: number; offsetX: number; offsetY: number; top: number; bottom: number; height: number };
  free: number; points: number; commerceReady: boolean; busy: boolean; error?: string;
  validate: (use: ToolUse) => boolean;
  placement: (kind: 'bounce' | 'stitch', position: LaunchPoint, angle?: number) => ToolUse | null;
  onConfirm: (use: ToolUse) => void; onCancel: () => void; onGetPoints: (use: ToolUse) => void;
}) {
  const { scale, offsetX, offsetY, top, bottom, height } = projection;
  const [position, setPosition] = useState(draft && 'position' in draft ? draft.position : data.position);
  const [angle, setAngle] = useState(draft?.tool === 'bounce' ? draft.angle : 0);
  const [targetId, setTargetId] = useState<string | null>(draft && 'targetId' in draft ? draft.targetId : null);
  const [panelHeight, setPanelHeight] = useState(250);
  const spatial = kind === 'bounce' || kind === 'stitch';
  const screen = (point: LaunchPoint) => ({ x: offsetX + point.x * scale, y: offsetY + (point.y - data.cameraY) * scale });
  const visibleBottom = height - bottom - panelHeight - 12;
  const targets = data.targets.filter(target => { const point = screen(target); return point.y >= top + 24 && point.y <= visibleBottom - 24; });
  const positions = data.placements.filter(point => { const projected = screen(point); return projected.y >= top + 24 && projected.y <= visibleBottom - 24; });
  const selected: ToolUse | null = spatial ? placement(kind, position, angle)
    : kind === 'pin' || kind === 'velcro' ? targetId ? { tool: kind, targetId } : null
      : { tool: kind };
  const valid = !!selected && validate(selected);
  const enough = free > 0 || commerceReady && points >= TOOL_COSTS[kind];
  const updatePosition = (point: LaunchPoint) => setPosition({ x: Math.round(point.x), y: Math.round(point.y) });
  const pan = useMemo(() => Gesture.Pan().withTestId('tool-placement-gesture').runOnJS(true).minDistance(0).maxPointers(1)
    .enabled(spatial && !busy).onBegin(event => {
      if (event.y >= top && event.y <= visibleBottom) setPosition({ x: Math.round((event.x - offsetX) / scale), y: Math.round((event.y - offsetY) / scale + data.cameraY) });
    }).onUpdate(event => {
      if (event.y >= top && event.y <= visibleBottom) setPosition({ x: Math.round((event.x - offsetX) / scale), y: Math.round((event.y - offsetY) / scale + data.cameraY) });
    }), [spatial, busy, top, visibleBottom, offsetX, offsetY, scale, data.cameraY]);
  const updateRotation = useCallback((event: { changeX: number; changeY: number }) => {
    setAngle(previous => {
      const initial = previous * Math.PI / 180;
      const value = Math.atan2(Math.sin(initial) * 52 * scale + event.changeY, Math.cos(initial) * 52 * scale + event.changeX) * 180 / Math.PI;
      return Math.round(value);
    });
  }, [scale]);
  const rotate = useMemo(() => Gesture.Pan().withTestId('tool-rotation-gesture').runOnJS(true).minDistance(0).maxPointers(1)
    .enabled(!busy).onChange(updateRotation), [busy, updateRotation]);
  const center = screen(position);
  return <View testID={`tool-setup-${kind}`} style={StyleSheet.absoluteFill} accessibilityViewIsModal pointerEvents="box-none">
    {spatial && <GestureDetector gesture={pan}><View testID="tool-placement-surface" style={StyleSheet.absoluteFill}>
      {kind === 'stitch' && positions.map(point => { const projected = screen(point); return <View key={`${point.x}:${point.y}`} pointerEvents="none" accessible={false}
        style={[styles.fabricMark, { left: projected.x - 5, top: projected.y - 5 }]} />; })}
      <View pointerEvents="none" testID="tool-placement-draft" style={[styles.draft, { left: center.x - (kind === 'bounce' ? 36 : 40) * scale,
        top: center.y - 6 * scale, width: (kind === 'bounce' ? 72 : 80) * scale, height: 12 * scale,
        transform: [{ rotate: `${kind === 'bounce' ? angle : 0}deg` }], borderColor: valid ? '#28594b' : '#a33842', backgroundColor: valid ? '#c9e0bd' : '#ecc3be' }]} />
    </View></GestureDetector>}
    {kind === 'bounce' && <GestureDetector gesture={rotate}><View testID="tool-rotation-handle" accessible={false}
      style={[styles.rotationHandle, { left: center.x + Math.cos(angle * Math.PI / 180) * 52 * scale - 24, top: center.y + Math.sin(angle * Math.PI / 180) * 52 * scale - 24 }]}><Text style={styles.buttonText}>↻</Text></View></GestureDetector>}
    {targets.map((target, index) => { const point = screen(target); return <Pressable key={target.id} testID={`tool-target-${target.id}`}
      accessibilityRole="button" accessibilityLabel={`${kind === 'pin' ? 'Pin' : 'Patch'} ${target.label || 'target'} ${index + 1}`}
      accessibilityState={{ selected: target.id === targetId }} onPress={() => setTargetId(target.id)}
      style={[styles.target, target.id === targetId && styles.prepared, { left: point.x - Math.max(48, target.width * scale) / 2, top: point.y - 24, width: Math.max(48, target.width * scale) }]}>
      <Text style={styles.targetText}>{target.id === targetId ? '✓ SELECTED' : kind === 'pin' ? 'PIN HERE' : 'PATCH HERE'}</Text>
    </Pressable>; })}
    <View onLayout={event => setPanelHeight(event.nativeEvent.layout.height)} style={[styles.setupPanel, { bottom, maxHeight: height * 0.48, left: 12, right: 12 }]}>
      <ScrollView testID="tool-setup-details" style={styles.setupScroller} contentContainerStyle={styles.panelContent}>
        <Text accessibilityRole="header" style={styles.title}>{TOOL_LABELS[kind]}</Text>
        <Text style={styles.copy}>{TOOL_DESCRIPTIONS[kind]}</Text>
        {spatial ? <>
          <Text style={styles.small}>{kind === 'bounce' ? 'Drag the patch, then drag ↻ to turn it.' : 'Drag into marked fabric, or adjust the position below.'}</Text>
          <View style={styles.adjustments}>
            <Adjustment label="X" value={position.x} onDecrease={() => updatePosition({ ...position, x: position.x - 10 })} onIncrease={() => updatePosition({ ...position, x: position.x + 10 })} />
            <Adjustment label="Y" value={position.y} onDecrease={() => updatePosition({ ...position, y: position.y - 10 })} onIncrease={() => updatePosition({ ...position, y: position.y + 10 })} />
            {kind === 'bounce' && <Adjustment label="Angle" value={(angle % 180 + 180) % 180} onDecrease={() => setAngle(angle - 5)} onIncrease={() => setAngle(angle + 5)} />}
          </View>
          {positions.length > 0 && <Pressable testID="tool-valid-position" accessibilityRole="button" onPress={() => updatePosition(positions[0])} style={styles.button}><Text style={styles.buttonText}>Use a marked spot</Text></Pressable>}
        </> : (kind === 'pin' || kind === 'velcro') && <Text style={styles.small}>{targets.length ? 'Tap a highlighted target.' : 'No eligible target is visible here.'}</Text>}
        <Text accessibilityLiveRegion="polite" style={styles.small}>{error || (valid ? 'Ready. Your climb is paused during setup.' : spatial ? 'Choose clear fabric away from pockets and obstacles.' : 'Select a target to continue.')}</Text>
      </ScrollView>
      <View testID="tool-setup-footer" style={styles.setupFooter}>
        <Text style={styles.price}>{free > 0 ? `${free} free · use one free charge` : `${TOOL_COSTS[kind]} points · ${points} available`}</Text>
        <View style={styles.row}>
          <Pressable testID="tool-setup-cancel" accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.button}><Text style={styles.buttonText}>Cancel</Text></Pressable>
          <Pressable testID={enough ? 'tool-setup-confirm' : 'tool-setup-points'} accessibilityRole="button" disabled={busy || !valid}
            accessibilityState={{ disabled: busy || !valid }} onPress={() => { if (selected) { if (enough) onConfirm(selected); else onGetPoints(selected); } }}
            style={[styles.button, styles.primary, (busy || !valid) && styles.disabled]}><Text style={styles.primaryText}>{enough ? free > 0 ? 'Use free tool' : `Use ${TOOL_COSTS[kind]} points` : 'Get points'}</Text></Pressable>
        </View>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  toolbox: { backgroundColor: '#fff8e7', borderRadius: 24, padding: 16, flexShrink: 1, maxHeight: '100%', borderWidth: 1, borderColor: '#c3b695' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  title: { flexShrink: 1, fontFamily: 'Fraunces_700Bold', fontSize: 22, color: '#244b45' },
  copy: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 14, lineHeight: 20, color: '#49635b', marginVertical: 8 },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 12 },
  card: { width: '48%', flexGrow: 1, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: '#c3b695', backgroundColor: '#f4ecd8', gap: 7 },
  prepared: { backgroundColor: '#dce9cf', borderColor: '#28594b' },
  unavailable: { opacity: 0.64 },
  cardTitle: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 15, color: '#244b45' },
  cardCopy: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 13, lineHeight: 18, color: '#49635b' },
  price: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 13, color: '#28594b', marginVertical: 8 },
  button: { minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: '#e8dfc9', flexShrink: 1 },
  buttonText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: '#244b45' },
  primary: { backgroundColor: '#28594b', flexGrow: 1 }, primaryText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 14, color: '#fff8e7' },
  disabled: { opacity: 0.5 }, row: { flexDirection: 'row', gap: 8 },
  setupPanel: { position: 'absolute', borderRadius: 20, borderWidth: 1, borderColor: '#c3b695', backgroundColor: '#fff8e7' },
  setupScroller: { flexShrink: 1, minHeight: 0 },
  setupFooter: { flexShrink: 0, paddingHorizontal: 14, paddingBottom: 12, borderTopWidth: 1, borderTopColor: '#ded3bb' },
  panelContent: { padding: 14 }, small: { fontFamily: 'NunitoSans_600SemiBold', fontSize: 12, lineHeight: 17, color: '#49635b', marginVertical: 4 },
  adjustments: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, adjustment: { flex: 1 },
  adjustButton: { flex: 1, minWidth: 36, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#e8dfc9' },
  draft: { position: 'absolute', borderWidth: 2, borderRadius: 7 }, fabricMark: { position: 'absolute', width: 10, height: 10, borderWidth: 1.5, borderRadius: 3, borderColor: '#28594b', backgroundColor: '#dce9cf' },
  target: { position: 'absolute', minHeight: 48, borderWidth: 2, borderColor: '#28594b', borderStyle: 'dashed', backgroundColor: '#fff8e7dd', borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  targetText: { fontFamily: 'NunitoSans_800ExtraBold', fontSize: 10, color: '#28594b' },
  rotationHandle: { position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff8e7', borderWidth: 2, borderColor: '#28594b', alignItems: 'center', justifyContent: 'center' },
});
