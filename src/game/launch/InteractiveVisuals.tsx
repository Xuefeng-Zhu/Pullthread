import { Circle, DashPathEffect, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { barrierIsActive, pocketPosition, shutterPhase } from './simulation';
import type { LaunchBarrier, LaunchPocket, LaunchRoom, LaunchState, LaunchSwitch } from './types';

interface Preferences {
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}

const SWITCH_GLYPHS = [
  'M 0 -4 L 4 0 L 0 4 L -4 0 Z',
  'M 0 -4 L 4 3 L -4 3 Z',
  'M -3 -3 L 3 -3 L 3 3 L -3 3 Z',
  'M -4 0 L 4 0 M 0 -4 L 0 4',
] as const;

function switchGlyph(id: string) {
  // Identity survives mirroring, activation, restoring, and section pruning.
  // The authored left/right button IDs also select distinct symbols.
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return SWITCH_GLYPHS[hash % SWITCH_GLYPHS.length];
}

export function OrbitVisual({ pocket, tick, highContrast }: {
  readonly pocket: LaunchPocket;
  readonly tick: SharedValue<number>;
  readonly highContrast: boolean;
}) {
  const radius = pocket.orbit!.radius;
  const ink = highContrast ? '#394F54' : '#798F8D';
  const endpoint = useDerivedValue(() => pocketPosition(pocket, tick.value));
  const direction = pocket.orbit?.direction ?? 1;
  return <Group>
    <Circle cx={pocket.center.x} cy={pocket.center.y} r={radius} color={highContrast ? '#C9D6CE' : '#D2C6AC'} style="stroke" strokeWidth={5} />
    <Circle cx={pocket.center.x} cy={pocket.center.y} r={radius} color={ink} style="stroke" strokeWidth={1.4}>
      <DashPathEffect intervals={[4, 4]} />
    </Circle>
    <Line p1={vec(pocket.center.x, pocket.center.y)} p2={endpoint} color={ink} strokeWidth={1.1} opacity={0.5}>
      <DashPathEffect intervals={[2, 6]} />
    </Line>
    <Circle cx={pocket.center.x} cy={pocket.center.y} r={6} color={highContrast ? '#F2F6E8' : '#F3EAD1'} />
    <Circle cx={pocket.center.x} cy={pocket.center.y} r={6} color={ink} style="stroke" strokeWidth={1.6} />
    <Circle cx={pocket.center.x} cy={pocket.center.y} r={1.5} color={ink} />
    <Group transform={[{ translateX: pocket.center.x }, { translateY: pocket.center.y - radius }, { scaleX: direction }]}>
      <Path path="M -7 -5 L 0 0 L -7 5" color={ink} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" />
    </Group>
  </Group>;
}

function BarrierVisual({ barrier, room, state, tick, highContrast, reducedMotion }: {
  readonly barrier: LaunchBarrier;
  readonly room: LaunchRoom;
  readonly state: LaunchState;
  readonly tick: SharedValue<number>;
} & Preferences) {
  const { width, height, kind } = barrier;
  const active = useDerivedValue(() => barrierIsActive(barrier, room, state, tick.value));
  const activeOpacity = useDerivedValue(() => active.value ? 1 : 0);
  const openOpacity = useDerivedValue(() => active.value ? 0 : 1);
  const warningOpacity = useDerivedValue(() => kind === 'shutter' && shutterPhase(barrier, tick.value) === 'warning' ? 1 : 0);
  const ink = kind === 'thorns' ? highContrast ? '#510F27' : '#723448'
    : kind === 'tearable' ? highContrast ? '#573040' : '#8E586E'
      : kind === 'shutter' ? highContrast ? '#493658' : '#71617C'
        : highContrast ? '#23433F' : '#496F68';
  const fill = kind === 'thorns' ? '#A85A6C' : kind === 'tearable' ? '#D9B0BE'
    : kind === 'shutter' ? '#B8A8CA' : kind === 'door' ? '#86ADA1' : '#A7BCB5';
  const event = state.event;
  const changeTick = event && (event.type === 'break' && event.id === barrier.id
    || event.type === 'switch' && room.switches?.some((item) => item.id === event.id && item.doorIds.includes(barrier.id))) ? event.tick : -1000;
  const flashOpacity = useDerivedValue(() => {
    const age = tick.value - changeTick;
    return reducedMotion || age < 0 || age >= 48 ? 0 : (1 - age / 48) * 0.8;
  });
  const pattern = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    if (kind === 'thorns') {
      const horizontal = width >= height;
      const length = horizontal ? width : height;
      const breadth = horizontal ? height : width;
      for (let position = 2; position < length - 2; position += 12) {
        const end = Math.min(length - 2, position + 10);
        if (horizontal) path.moveTo(position, breadth - 3).lineTo((position + end) / 2, 3).lineTo(end, breadth - 3);
        else path.moveTo(breadth - 3, position).lineTo(3, (position + end) / 2).lineTo(breadth - 3, end);
      }
    } else if (kind === 'shutter') {
      // Both sharp zipper edges sit inside the exact lethal rectangle.
      const horizontal = width >= height;
      const length = horizontal ? width : height;
      const breadth = horizontal ? height : width;
      const edge = Math.min(2, breadth / 4);
      const point = (along: number, across: number, first = false) => {
        const x = horizontal ? along : across;
        const y = horizontal ? across : along;
        if (first) path.moveTo(x, y); else path.lineTo(x, y);
      };
      for (let position = edge; position < length - edge - 4; position += 12) {
        const end = Math.min(length - edge, position + 8);
        point(position, edge, true);
        point((position + end) / 2, breadth * 0.64);
        point(end, edge);
        path.close();
        const lowerStart = position + 5;
        const lowerEnd = Math.min(length - edge, lowerStart + 8);
        if (lowerEnd > lowerStart) {
          point(lowerStart, breadth - edge, true);
          point((lowerStart + lowerEnd) / 2, breadth * 0.36);
          point(lowerEnd, breadth - edge);
          path.close();
        }
      }
    } else if (kind === 'tearable') {
      path.moveTo(width / 2, 2);
      for (let y = 5; y < height - 2; y += 8) path.lineTo(width / 2 + (Math.floor(y / 8) % 2 ? -3 : 3), y);
      path.lineTo(width / 2, height - 2);
    } else if (kind !== 'door') {
      for (let y = 7; y < height - 2; y += 12) path.moveTo(3, y).lineTo(width - 3, y);
    }
    return path.detach();
  }, [height, kind, width]);
  const inset = Math.min(4, width / 6, height / 6);
  const torn = kind === 'tearable';
  const linkedSwitches = kind === 'door' ? room.switches?.filter((item) => item.doorIds.includes(barrier.id)) ?? [] : [];
  return <Group transform={[{ translateX: barrier.x }, { translateY: barrier.y }]}>
    <Group opacity={activeOpacity}>
      <Rect x={0} y={0} width={width} height={height} color={fill} />
      <Rect x={0.8} y={0.8} width={Math.max(0.1, width - 1.6)} height={Math.max(0.1, height - 1.6)} color={ink} style="stroke" strokeWidth={1.6} />
      <Rect x={inset} y={inset} width={width - inset * 2} height={height - inset * 2} color={highContrast ? ink : '#FFF1DB'} style="stroke" strokeWidth={1}>
        <DashPathEffect intervals={torn ? [2, 5] : [3, 4]} />
      </Rect>
      <Path path={pattern} color={ink} style={kind === 'shutter' ? 'fill' : 'stroke'} strokeWidth={kind === 'thorns' ? 2.4 : 1.6} strokeJoin="round">
        {torn && <DashPathEffect intervals={[2, 3]} />}
      </Path>
      {linkedSwitches.map((item, index) => <Group key={item.id} transform={[
        { translateX: width / 2 + (index - (linkedSwitches.length - 1) / 2) * 11 }, { translateY: height / 2 },
        { scale: Math.min(1, (height - 2) / 10, width / (linkedSwitches.length * 11)) },
      ]}>
        <Circle cx={0} cy={0} r={5} color={fill} />
        <Path path={switchGlyph(item.id)} color={ink} style="stroke" strokeWidth={1.6} strokeJoin="round" />
      </Group>)}
    </Group>
    <Group opacity={openOpacity}>
      {/* Only remnants remain in a passable opening; there is no solid face. */}
      <Path path={`M 1 ${inset * 2} L 1 1 L ${inset * 2} 1 M ${width - inset * 2} 1 L ${width - 1} 1 L ${width - 1} ${inset * 2} M 1 ${height - inset * 2} L 1 ${height - 1} L ${inset * 2} ${height - 1} M ${width - inset * 2} ${height - 1} L ${width - 1} ${height - 1} L ${width - 1} ${height - inset * 2}`}
        color={ink} style="stroke" strokeWidth={1.5} opacity={0.5} />
      {torn && <Path path={`M 1 ${height * 0.35} l ${inset} 3 l ${-inset} 4 M ${width - 1} ${height * 0.65} l ${-inset} -3 l ${inset} -4`}
        color={ink} style="stroke" strokeWidth={1.2} opacity={0.65} />}
    </Group>
    <Group opacity={warningOpacity}>
      <Rect x={1} y={1} width={Math.max(0.1, width - 2)} height={Math.max(0.1, height - 2)} color={highContrast ? '#764515' : '#A77534'} style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[5, 3]} />
      </Rect>
      <Path path={`M ${width / 2} ${height / 2 - 4} l 0 5 M ${width / 2} ${height / 2 + 4} l 0 0.5`}
        color={highContrast ? '#764515' : '#A77534'} style="stroke" strokeWidth={2.5} strokeCap="round" />
    </Group>
    <Group opacity={flashOpacity}>
      <Rect x={1} y={1} width={Math.max(0.1, width - 2)} height={Math.max(0.1, height - 2)} color="#FFF7E7" style="stroke" strokeWidth={2} />
    </Group>
  </Group>;
}

function SwitchVisual({ item, room, state, highContrast }: {
  readonly item: LaunchSwitch;
  readonly room: LaunchRoom;
  readonly state: LaunchState;
  readonly highContrast: boolean;
}) {
  const activated = state.activatedSwitchIds?.includes(item.id) ?? false;
  const ink = highContrast ? '#254E4B' : '#4D7870';
  const links = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    for (const door of room.barriers?.filter((barrier) => barrier.kind === 'door' && item.doorIds.includes(barrier.id)) ?? []) {
      const x = door.x + door.width / 2;
      const y = door.y + door.height / 2;
      path.moveTo(item.center.x, item.center.y).cubicTo(item.center.x, (item.center.y + y) / 2, x, (item.center.y + y) / 2, x, y);
    }
    return path.detach();
  }, [item.center.x, item.center.y, item.doorIds, room.barriers]);
  return <>
    <Path path={links} color={ink} style="stroke" strokeWidth={activated ? 2 : 1.5} opacity={activated ? 0.65 : 0.4}>
      <DashPathEffect intervals={[3, 5]} />
    </Path>
    <Group transform={[{ translateX: item.center.x }, { translateY: item.center.y }]}>
      <Circle cx={0} cy={0} r={item.radius} color={activated ? '#B8D2B8' : '#E7DDD0'} />
      <Circle cx={0} cy={0} r={item.radius - 1} color={ink} style="stroke" strokeWidth={2} />
      <Circle cx={0} cy={0} r={Math.max(1, item.radius - 4)} color={ink} style="stroke" strokeWidth={1}>
        <DashPathEffect intervals={[2, 3]} />
      </Circle>
      <Group transform={[{ scale: Math.min(1.8, (item.radius - 5) / 5) }]}>
        <Path path={switchGlyph(item.id)} color={ink} style="stroke" strokeWidth={1.5} strokeCap="round" strokeJoin="round" />
      </Group>
      {activated && <Group transform={[{ translateX: item.radius * 0.6 }, { translateY: item.radius * 0.6 }]}>
        <Circle cx={0} cy={0} r={6} color="#EAF2DD" />
        <Path path="M -3 0 L -1 2 L 3 -2" color={ink} style="stroke" strokeWidth={1.8} strokeCap="round" strokeJoin="round" />
      </Group>}
    </Group>
  </>;
}

export function InteractiveVisuals({ room, state, tick, highContrast, reducedMotion }: {
  readonly room: LaunchRoom;
  readonly state: LaunchState;
  readonly tick: SharedValue<number>;
} & Preferences) {
  return <>
    {room.switches?.map((item) => <SwitchVisual key={item.id} item={item} room={room} state={state} highContrast={highContrast} />)}
    {room.barriers?.map((barrier) => <BarrierVisual key={barrier.id} barrier={barrier} room={room} state={state}
      tick={tick} highContrast={highContrast} reducedMotion={reducedMotion} />)}
  </>;
}
