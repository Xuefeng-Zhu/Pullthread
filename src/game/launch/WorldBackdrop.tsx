import { Circle, DashPathEffect, Group, Line, Path, RoundedRect, Skia, vec } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { FabricTexture } from '../rendering/FabricTexture';
import { WORLD_STAGES, WORLD_TRANSITION_TICKS } from './progression';

const WORLD_FABRICS = [
  { contrast: '#FFF0C9', patch: '#FAEDD3' },
  { contrast: '#ECF2DF', patch: '#EDF1DA' },
  { contrast: '#ECF5FA', patch: '#F7F7EC' },
  { contrast: '#FCE8DA', patch: '#FAE8CD' },
  { contrast: '#F1EAF8', patch: '#F7ECD7' },
] as const;

interface WorldBackdropProps {
  readonly width: number;
  readonly height: number;
  /** Unbounded 20-catch ordinal; colors repeat every five stages. */
  readonly worldStage: number;
  /** Absent on restoration so the current world appears immediately. */
  readonly worldTransitionTick?: number;
  readonly tick: SharedValue<number>;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}

/** Ornaments stay within a narrow strip at either screen edge. */
const EdgeMotif = memo(function EdgeMotif({ stage, thread, patch }: {
  readonly stage: number;
  readonly thread: string;
  readonly patch: string;
}) {
  if (stage === 1) return <>
    <Path path="M 0 50 Q -7 15 1 -29 Q 6 -47 0 -62" color={thread} style="stroke" strokeWidth={2} />
    <Path path="M -1 24 Q -27 16 -17 -5 Q 3 0 -1 24 Z M 0 -2 Q 26 -15 18 -32 Q -1 -21 0 -2 Z" color={patch} />
    <Path path="M -1 24 Q -27 16 -17 -5 Q 3 0 -1 24 Z M 0 -2 Q 26 -15 18 -32 Q -1 -21 0 -2 Z" color={thread} style="stroke" strokeWidth={1.1}>
      <DashPathEffect intervals={[2, 3]} />
    </Path>
    {[-1, 1].map((side) => <Circle key={side} cx={side * 6} cy={-56} r={6} color={patch} />)}
    <Circle cx={0} cy={-62} r={6} color={patch} />
    <Circle cx={0} cy={-52} r={5} color={thread} />
  </>;
  if (stage === 2) return <>
    <Path path="M -20 -11 C -25 -22 -16 -32 -7 -29 C -5 -45 16 -44 18 -29 C 32 -27 30 -10 17 -9 Z" color={patch} />
    <Path path="M -17 -15 C -22 -23 -14 -29 -4 -26 C -3 -39 14 -39 14 -25 C 25 -24 25 -15 16 -14 Z" color={thread} style="stroke" strokeWidth={1.1}>
      <DashPathEffect intervals={[2, 3]} />
    </Path>
    <Path path="M -9 4 C 18 14 -25 31 -7 45 C 5 54 15 43 9 36 M 5 4 C 30 17 -12 34 9 47" color={thread} style="stroke" strokeWidth={2} strokeCap="round" />
  </>;
  if (stage === 3) return <>
    <RoundedRect x={-12} y={-38} width={24} height={39} r={5} color={patch} />
    <RoundedRect x={-17} y={-43} width={34} height={8} r={4} color={thread} />
    <RoundedRect x={-17} y={-2} width={34} height={8} r={4} color={thread} />
    {[-29, -22, -15, -8].map((y) => <Line key={y} p1={vec(-11, y)} p2={vec(11, y + 4)} color={thread} strokeWidth={1.5} />)}
    <Circle cx={5} cy={41} r={15} color={patch} />
    <Circle cx={5} cy={41} r={12} color={thread} style="stroke" strokeWidth={5}>
      <DashPathEffect intervals={[3, 5]} />
    </Circle>
    <Circle cx={5} cy={41} r={4} color={thread} />
  </>;
  if (stage === 4) return <>
    <Path path="M 12 -43 C -26 -43 -25 -2 11 -5 C -8 -10 -9 -32 12 -43 Z" color={patch} />
    <Path path="M 8 -39 C -20 -37 -20 -6 6 -8" color={thread} style="stroke" strokeWidth={1.2}>
      <DashPathEffect intervals={[2, 3]} />
    </Path>
    <Path path="M 1 18 L 4 28 L 14 31 L 4 34 L 1 44 L -2 34 L -12 31 L -2 28 Z M 17 3 L 19 9 L 25 11 L 19 13 L 17 19 L 15 13 L 9 11 L 15 9 Z" color={patch} />
    <Path path="M 1 25 L 1 37 M -5 31 L 7 31" color={thread} style="stroke" strokeWidth={1.1} />
  </>;
  return <>
    <Path path="M -17 -52 Q 22 -27 -6 -8 Q -25 4 -7 23 Q 18 41 7 59" color={thread} style="stroke" strokeWidth={2} strokeCap="round" />
    <Path path="M -13 -49 Q 26 -27 -2 -7 Q -21 5 -3 22 Q 22 42 11 59" color={patch} style="stroke" strokeWidth={1.2}>
      <DashPathEffect intervals={[3, 4]} />
    </Path>
    <Circle cx={3} cy={-29} r={9} color={patch} />
    <Circle cx={3} cy={-29} r={7} color={thread} style="stroke" strokeWidth={1.1} />
    <Circle cx={0} cy={-29} r={1.2} color={thread} />
    <Circle cx={6} cy={-29} r={1.2} color={thread} />
  </>;
});

const FabricWorld = memo(function FabricWorld({ width, height, stage, highContrast }: {
  readonly width: number;
  readonly height: number;
  readonly stage: number;
  readonly highContrast: boolean;
}) {
  const fabric = WORLD_FABRICS[stage];
  const world = WORLD_STAGES[stage];
  const ornaments = useMemo(() => Array.from({ length: Math.ceil(height / 230) }, (_, row) =>
    [0, 1].map((side) => ({ x: side === 0 ? 24 : width - 24, y: 114 + row * 230 + side * 48, side }))).flat(), [height, width]);
  const seams = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    path.moveTo(0, height * 0.31).cubicTo(width * 0.35, height * 0.27, width * 0.62, height * 0.38, width, height * 0.3);
    path.moveTo(0, height * 0.73).cubicTo(width * 0.36, height * 0.79, width * 0.64, height * 0.64, width, height * 0.7);
    return path.detach();
  }, [height, width]);
  return <>
    <FabricTexture width={width} height={height} highContrast={highContrast} baseColor={highContrast ? fabric.contrast : world.base} />
    <Path path={seams} color={fabric.patch} style="stroke" strokeWidth={20} opacity={highContrast ? 0.18 : 0.32} />
    <Path path={seams} color={world.ink} style="stroke" strokeWidth={1} opacity={highContrast ? 0.16 : 0.26}>
      <DashPathEffect intervals={[4, 5]} />
    </Path>
    <Group opacity={highContrast ? 0.27 : 0.45}>
      {ornaments.map(({ x, y, side }, index) => <Group key={index} transform={[{ translateX: x }, { translateY: y }, { scaleX: side === 0 ? 1 : -1 }]}>
        <EdgeMotif stage={stage} thread={world.ink} patch={fabric.patch} />
      </Group>)}
    </Group>
  </>;
});

/** Static geometry is memoized; only the current layer's opacity follows the clock. */
export const WorldBackdrop = memo(function WorldBackdrop({ width, height, worldStage, worldTransitionTick, tick, highContrast, reducedMotion }: WorldBackdropProps) {
  const stage = ((Math.floor(worldStage) % 5) + 5) % 5;
  const transitioning = worldTransitionTick !== undefined && worldStage > 0 && !reducedMotion;
  const opacity = useDerivedValue(() => !transitioning || worldTransitionTick === undefined
    ? 1 : Math.min(1, Math.max(0, (tick.value - worldTransitionTick) / WORLD_TRANSITION_TICKS)));
  return <>
    {transitioning && <FabricWorld width={width} height={height} stage={(stage + 4) % 5} highContrast={highContrast} />}
    <Group opacity={opacity}>
      <FabricWorld width={width} height={height} stage={stage} highContrast={highContrast} />
    </Group>
  </>;
});
