import { Circle, DashPathEffect, Group, Line, Path, RoundedRect, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { effectivePockets } from './tools';
import { hazardPosition, pocketPosition } from './simulation';
import type { LaunchCanvasMotion } from './LaunchCanvas';
import type { LaunchRoom, LaunchState } from './types';

function TargetMark({ id, kind, room, state, motion }: {
  id: string; kind: 'pin' | 'velcro'; room: LaunchRoom; state: LaunchState; motion: LaunchCanvasMotion;
}) {
  const pocket = effectivePockets(room, state).find(value => value.id === id);
  const hazard = room.hazards.find(value => value.id === id);
  const barrier = room.barriers?.find(value => value.id === id);
  const { tick } = motion;
  const transform = useDerivedValue(() => {
    const point = pocket ? pocketPosition(pocket, tick.value, state) : hazard ? hazardPosition(hazard, tick.value, state)
      : barrier ? { x: barrier.x + barrier.width / 2, y: barrier.y + barrier.height / 2 } : { x: 0, y: 0 };
    return [{ translateX: point.x }, { translateY: point.y }];
  });
  if (!pocket && !hazard && !barrier) return null;
  return <Group transform={transform}>
    {kind === 'velcro' ? <>
      <RoundedRect x={-(pocket?.width ?? 80) / 2} y={-14} width={pocket?.width ?? 80} height={28} r={14} color="#fff2c8" opacity={0.45} />
      <RoundedRect x={-(pocket?.width ?? 80) / 2} y={-14} width={pocket?.width ?? 80} height={28} r={14} color="#614b30" style="stroke" strokeWidth={2}>
        <DashPathEffect intervals={[2, 3]} />
      </RoundedRect>
    </> : <Group transform={[{ translateX: 0 }, { translateY: -25 }]}>
      <Circle cx={0} cy={0} r={11} color="#fff8e7" />
      <Path path="M -4 5 L 5 -5 Q 9 -9 5 -10 Q 2 -11 0 -6 L -5 2 Q -8 7 -4 8 L 3 8 L 3 4" color="#395b52" style="stroke" strokeWidth={2} strokeCap="round" />
    </Group>}
  </Group>;
}

/** Transient tool geometry is rendered from the same state used by collision and replay. */
export function LaunchToolVisuals({ room, state, motion }: { room: LaunchRoom; state: LaunchState; motion: LaunchCanvasMotion }) {
  const effects = state.toolEffects;
  const { travelerX, travelerY, velocityY } = motion;
  const traveler = useDerivedValue(() => [{ translateX: travelerX.value }, { translateY: travelerY.value }]);
  const sailOpacity = useDerivedValue(() => effects?.sail && state.phase === 'flying' && (velocityY?.value ?? state.velocity.y) >= 0 ? 1 : 0);
  return <>
    {effects?.bounce && !effects.bounce.spent && <Group transform={[{ translateX: effects.bounce.position.x }, { translateY: effects.bounce.position.y }, { rotate: effects.bounce.angle * Math.PI / 180 }]}>
      <RoundedRect x={-36} y={-6} width={72} height={12} r={6} color="#b9d6b2" />
      <RoundedRect x={-36} y={-6} width={72} height={12} r={6} color="#28594b" style="stroke" strokeWidth={2} />
      <Line p1={vec(-25, 0)} p2={vec(25, 0)} color="#fff8e7" strokeWidth={1.5}><DashPathEffect intervals={[3, 3]} /></Line>
    </Group>}
    {effects?.pin && <TargetMark kind="pin" id={effects.pin.targetId} room={room} state={state} motion={motion} />}
    {effects?.velcro && <TargetMark kind="velcro" id={effects.velcro.targetId} room={room} state={state} motion={motion} />}
    <Group transform={traveler}>
      <Group opacity={sailOpacity}>
        <Path path="M -23 -25 Q 0 -58 23 -25 Q 12 -31 0 -25 Q -12 -31 -23 -25 Z" color="#f4e4b4" />
        <Path path="M -23 -25 Q 0 -58 23 -25 M -23 -25 L -6 -7 M 23 -25 L 6 -7 M 0 -41 L 0 -8" color="#685746" style="stroke" strokeWidth={1.5} />
      </Group>
      {effects?.needle && !effects.needle.piercedId && <>
        <Path path="M 0 -8 L 0 -28 L 3 -22 L 0 -8" color="#fff8e7" style="stroke" strokeWidth={4} strokeCap="round" />
        <Path path="M 0 -8 L 0 -28 L 3 -22 L 0 -8" color="#395b52" style="stroke" strokeWidth={1.5} strokeCap="round" />
      </>}
    </Group>
  </>;
}
