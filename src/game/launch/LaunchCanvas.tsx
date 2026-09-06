import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Path,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { getGamePalette } from '../../theme/gamePalette';
import { FabricTexture } from '../rendering/FabricTexture';
import { Traveler } from '../rendering/Traveler';
import {
  BUTTON_RADIUS,
  LAUNCH_HZ,
  LAUNCH_POWER,
  MAX_PULL,
  MIN_PULL,
  pocketPosition,
} from './simulation';
import type {
  LaunchBumper,
  LaunchHazard,
  LaunchPocket,
  LaunchRoom,
  LaunchState,
} from './types';
import { getLaunchViewport } from './viewport';

/** The simulation publishes these values without rerendering React every tick. */
export interface LaunchCanvasMotion {
  readonly travelerX: SharedValue<number>;
  readonly travelerY: SharedValue<number>;
  readonly tick: SharedValue<number>;
  readonly pullX: SharedValue<number>;
  readonly pullY: SharedValue<number>;
  readonly impactTick: SharedValue<number>;
  readonly impactX: SharedValue<number>;
  readonly impactY: SharedValue<number>;
  /** Absolute world y of the simulation's camera origin. */
  readonly cameraY?: SharedValue<number>;
}

interface LaunchCanvasProps {
  readonly room: LaunchRoom;
  readonly state: LaunchState;
  readonly motion: LaunchCanvasMotion;
  readonly size: { readonly width: number; readonly height: number };
  readonly highContrast?: boolean;
  readonly reducedMotion?: boolean;
  readonly showTutorial?: boolean;
  /** Marks the next endless checkpoint with the same gold pennants as a goal. */
  readonly nextPocketId?: string;
  /** Screen space reserved below the visible physical floor. */
  readonly bottomInset?: number;
}

interface VisualPreferences {
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}

function starPath(radius: number, points: number, innerRatio: number) {
  const path = Skia.PathBuilder.Make();
  for (let index = 0; index < points * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / points;
    const distance = index % 2 === 0 ? radius : radius * innerRatio;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  return path.close().detach();
}

function PocketVisual({
  pocket,
  state,
  motion,
  highContrast,
  reducedMotion,
  highlighted,
}: {
  readonly pocket: LaunchPocket;
  readonly state: LaunchState;
  readonly motion: LaunchCanvasMotion;
  readonly highlighted: boolean;
} & VisualPreferences) {
  const occupied = pocket.id === state.pocketId && state.phase === 'held';
  const isTarget = pocket.kind === 'goal' || highlighted;
  const half = pocket.width / 2;
  const fill = isTarget ? '#D4A63D' : pocket.kind === 'start' ? '#BE5D51' : '#659C97';
  const outline = highContrast
    ? '#392B26'
    : isTarget ? '#8D6924' : pocket.kind === 'start' ? '#823F3A' : '#315E5E';
  const accent = isTarget ? '#FFF1BD' : '#FFF0D7';
  const event = state.event;
  const pocketEventTick = event && 'id' in event && event.id === pocket.id
    && (event.type === 'launch' || event.type === 'catch') ? event.tick : -1000;
  const transform = useDerivedValue(() => {
    const center = pocketPosition(pocket, motion.tick.value);
    return [{ translateX: center.x }, { translateY: center.y }];
  });
  const deformation = useDerivedValue(() => {
    const age = motion.tick.value - pocketEventTick;
    const snap = !reducedMotion && age >= 0 && age < 55
      ? Math.sin(age * 0.37) * Math.exp(-age / 15) * 10 : 0;
    return {
      x: occupied ? motion.pullX.value : 0,
      y: (occupied ? motion.pullY.value : 0) + snap,
    };
  });
  const cup = useDerivedValue(() => {
    const { x, y } = deformation.value;
    return Skia.PathBuilder.Make()
      .moveTo(-half, 0)
      .quadTo(0, 5, half, 0)
      .cubicTo(half + 3, 22, x + half * 0.62, y + 34, x, y + 35)
      .cubicTo(x - half * 0.62, y + 34, -half - 3, 22, -half, 0)
      .close().detach();
  });
  const hem = useDerivedValue(() => {
    const { x, y } = deformation.value;
    return Skia.PathBuilder.Make()
      .moveTo(-half + 6, 7)
      .cubicTo(-half + 2, 23, x - half * 0.56, y + 28, x, y + 29)
      .cubicTo(x + half * 0.56, y + 28, half - 2, 23, half - 6, 7)
      .detach();
  });
  const emblemTransform = useDerivedValue(() => [
    { translateX: deformation.value.x * 0.55 },
    { translateY: 19 + deformation.value.y * 0.6 },
  ]);
  const diamond = useMemo(() => starPath(6, 4, 0.65), []);

  return (
    <Group transform={transform}>
      {isTarget ? (
        <>
          <Line p1={vec(-half + 7, -26)} p2={vec(-half + 7, -5)} color={outline} strokeWidth={2} />
          <Path
            path={`M ${-half + 8} -26 l 18 4 l -18 6 Z`}
            color={fill}
          />
          <Line p1={vec(half - 7, -26)} p2={vec(half - 7, -5)} color={outline} strokeWidth={2} />
          <Path
            path={`M ${half - 8} -26 l -18 4 l 18 6 Z`}
            color={fill}
          />
        </>
      ) : null}
      <Group transform={[{ translateY: 4 }]} opacity={0.16}>
        <Path path={cup} color="#3F3429" />
      </Group>
      <Path path={cup} color={fill} />
      <Path path={cup} color={outline} style="stroke" strokeWidth={2} />
      <Path path={hem} color={accent} style="stroke" strokeWidth={1.5} strokeCap="round">
        <DashPathEffect intervals={[3, 4]} />
      </Path>
      <Line
        p1={vec(-half + 3, 1)} p2={vec(half - 3, 1)}
        color={outline} strokeWidth={5} strokeCap="round"
      />
      <Line
        p1={vec(-half + 4, -1)} p2={vec(half - 4, -1)}
        color={accent} strokeWidth={1.5} strokeCap="round"
      />
      <Group transform={emblemTransform}>
        {isTarget ? <Path path={diamond} color={accent} /> : (
          <>
            <Line p1={vec(-4, -3)} p2={vec(4, 3)} color={accent} strokeWidth={1.5} />
            <Line p1={vec(-4, 3)} p2={vec(4, -3)} color={accent} strokeWidth={1.5} />
          </>
        )}
      </Group>
      {[-half, half].map((x) => (
        <Group key={x}>
          <Circle cx={x} cy={0} r={4.5} color={outline} />
          <Circle cx={x - 0.5} cy={-0.5} r={2} color={accent} />
        </Group>
      ))}
      {occupied ? (
        <Circle cx={0} cy={-19} r={2.5} color={outline} />
      ) : null}
    </Group>
  );
}

function BumperVisual({ bumper, motion, highContrast, reducedMotion }: {
  readonly bumper: LaunchBumper;
  readonly motion: LaunchCanvasMotion;
} & VisualPreferences) {
  const { radius } = bumper;
  const transform = useDerivedValue(() => {
    const age = motion.tick.value - motion.impactTick.value;
    const nearby = Math.hypot(motion.impactX.value - bumper.center.x, motion.impactY.value - bumper.center.y)
      < radius + BUTTON_RADIUS + 8;
    const compression = !reducedMotion && nearby && age >= 0 && age < 35
      ? Math.sin(age * 0.36) * Math.exp(-age / 10) * 0.16 : 0;
    return [
      { translateX: bumper.center.x }, { translateY: bumper.center.y },
      { scaleX: 1 + compression }, { scaleY: 1 - compression },
    ];
  });
  const petals = useMemo(() => Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2;
    return { x: Math.cos(angle) * radius * 0.8, y: Math.sin(angle) * radius * 0.8 };
  }), [radius]);
  const spring = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    path.moveTo(-radius * 0.48, 0);
    for (let index = 0; index < 6; index += 1) {
      const x = -radius * 0.4 + (index / 5) * radius * 0.8;
      path.lineTo(x, (index % 2 === 0 ? -1 : 1) * radius * 0.2);
    }
    return path.lineTo(radius * 0.48, 0).detach();
  }, [radius]);
  return (
    <Group transform={transform}>
      <Circle cx={1} cy={4} r={radius + 1} color="rgba(61,45,32,0.18)" />
      {petals.map((petal, index) => (
        <Circle key={index} cx={petal.x} cy={petal.y} r={radius * 0.23} color="#4F747E" />
      ))}
      <Circle cx={0} cy={0} r={radius * 0.85} color={highContrast ? '#204652' : '#57838B'} />
      <Circle cx={0} cy={0} r={radius * 0.67} color="#ADC5B8" />
      <Circle cx={0} cy={0} r={radius * 0.76} color="#F9ECD0" style="stroke" strokeWidth={1.3}>
        <DashPathEffect intervals={[2.5, 3]} />
      </Circle>
      <Path path={spring} style="stroke" strokeWidth={2.4} color="#294E58" strokeJoin="round" strokeCap="round" />
    </Group>
  );
}

function ThornVisual({ hazard, highContrast }: {
  readonly hazard: LaunchHazard;
  readonly highContrast: boolean;
}) {
  // Outer points match the circular collision boundary; the darker inner disc
  // makes the dangerous surface readable without relying on red alone.
  const outline = useMemo(() => starPath(hazard.radius, 9, 0.69), [hazard.radius]);
  return (
    <Group transform={[{ translateX: hazard.center.x }, { translateY: hazard.center.y }]}>
      <Group transform={[{ translateY: 3 }]} opacity={0.14}>
        <Path path={outline} color="#332326" />
      </Group>
      <Path path={outline} color={highContrast ? '#781C31' : '#A54A53'} />
      <Path path={outline} style="stroke" strokeWidth={1.5} color="#652F38" />
      <Circle cx={0} cy={0} r={hazard.radius * 0.49} color="#743B44" />
      <Line
        p1={vec(-hazard.radius * 0.18, -hazard.radius * 0.18)}
        p2={vec(hazard.radius * 0.18, hazard.radius * 0.18)}
        color="#EDC1AD" strokeWidth={2} strokeCap="round"
      />
      <Line
        p1={vec(hazard.radius * 0.18, -hazard.radius * 0.18)}
        p2={vec(-hazard.radius * 0.18, hazard.radius * 0.18)}
        color="#EDC1AD" strokeWidth={2} strokeCap="round"
      />
    </Group>
  );
}

function AimVisual({ room, motion, highContrast }: {
  readonly room: LaunchRoom;
  readonly motion: LaunchCanvasMotion;
  readonly highContrast: boolean;
}) {
  const opacity = useDerivedValue(() => Math.hypot(motion.pullX.value, motion.pullY.value) >= MIN_PULL ? 1 : 0);
  const trajectory = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    const x = motion.travelerX.value;
    const y = motion.travelerY.value;
    const vx = -motion.pullX.value * LAUNCH_POWER;
    const vy = -motion.pullY.value * LAUNCH_POWER;
    path.moveTo(x, y);
    // Only the first 0.28 seconds: the player still discovers the route.
    for (let index = 1; index <= 14; index += 1) {
      const t = index * 0.02;
      path.lineTo(x + vx * t, y + vy * t + 0.5 * room.gravity * t * t);
    }
    return path.detach();
  });
  const arrow = useDerivedValue(() => {
    const dx = -motion.pullX.value;
    const dy = -motion.pullY.value;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const tipX = motion.travelerX.value + ux * 25;
    const tipY = motion.travelerY.value + uy * 25;
    return Skia.PathBuilder.Make()
      .moveTo(tipX - ux * 7 - uy * 4, tipY - uy * 7 + ux * 4)
      .lineTo(tipX, tipY)
      .lineTo(tipX - ux * 7 + uy * 4, tipY - uy * 7 - ux * 4)
      .detach();
  });
  const power = useDerivedValue(() => Math.min(1, Math.hypot(motion.pullX.value, motion.pullY.value) / MAX_PULL));
  const powerWidth = useDerivedValue(() => Math.max(0.1, power.value * 34));
  const powerTransform = useDerivedValue(() => [
    { translateX: motion.travelerX.value - 19 },
    { translateY: motion.travelerY.value + 20 },
  ]);
  const color = highContrast ? '#193D49' : '#315D65';
  return (
    <Group opacity={opacity}>
      <Path path={trajectory} style="stroke" strokeWidth={2} color={color} strokeCap="round">
        <DashPathEffect intervals={[2, 7]} />
      </Path>
      <Path path={arrow} style="stroke" strokeWidth={2} color={color} strokeCap="round" strokeJoin="round" />
      <Group transform={powerTransform}>
        <RoundedRect x={0} y={0} width={38} height={7} r={3.5} color="#FFF2D8" />
        <RoundedRect x={0} y={0} width={38} height={7} r={3.5} color={color} style="stroke" strokeWidth={1} />
        <RoundedRect x={2} y={2} width={powerWidth} height={3} r={1.5} color={color} />
      </Group>
    </Group>
  );
}

function TutorialGesture({ pocket, motion, reducedMotion }: {
  readonly pocket: LaunchPocket;
  readonly motion: LaunchCanvasMotion;
  readonly reducedMotion: boolean;
}) {
  const transform = useDerivedValue(() => {
    const cycle = (motion.tick.value / LAUNCH_HZ) % 2.6;
    const pull = reducedMotion ? 0.72 : Math.min(1, Math.max(0, (cycle - 0.3) / 1.2));
    return [
      { translateX: pocket.center.x - pull * 24 },
      { translateY: pocket.center.y + pull * 72 },
    ];
  });
  const opacity = useDerivedValue(() => {
    if (Math.hypot(motion.pullX.value, motion.pullY.value) > 3) return 0;
    if (reducedMotion) return 0.6;
    const cycle = (motion.tick.value / LAUNCH_HZ) % 2.6;
    return cycle > 2.1 ? Math.max(0, (2.6 - cycle) * 1.5) : 0.75;
  });
  return (
    <Group opacity={opacity}>
      <Line
        p1={vec(pocket.center.x - 2, pocket.center.y + 13)}
        p2={vec(pocket.center.x - 24, pocket.center.y + 72)}
        color="#804938" strokeWidth={1.5}
      >
        <DashPathEffect intervals={[3, 4]} />
      </Line>
      <Group transform={transform}>
        <Circle cx={0} cy={0} r={13} color="#FFF8E6" />
        <Circle cx={0} cy={0} r={13} color="#804938" style="stroke" strokeWidth={1.5} />
        <Circle cx={0} cy={0} r={4} color="#804938" />
        <Path path="M 7 7 L 14 16 L 18 12" style="stroke" strokeWidth={3} color="#804938" strokeCap="round" strokeJoin="round" />
      </Group>
    </Group>
  );
}

export function LaunchCanvas({
  room,
  state,
  motion,
  size,
  highContrast = false,
  reducedMotion = false,
  showTutorial = false,
  nextPocketId,
  bottomInset = 0,
}: LaunchCanvasProps) {
  const palette = getGamePalette(highContrast);
  const width = room.bounds.width;
  const { scale, offsetX, offsetY } = getLaunchViewport(size, room.bounds, bottomInset);
  const floorY = size.height - bottomInset;
  const cameraTransform = useDerivedValue(() => [
    { translateY: -(motion.cameraY?.value ?? 0) },
  ]);
  const speed = useDerivedValue<number>(() => state.phase === 'flying' && !reducedMotion ? 0.6 : 0);
  const impactOpacity = useDerivedValue(() => {
    const age = motion.tick.value - motion.impactTick.value;
    return reducedMotion || motion.impactTick.value < 0 || age < 0 || age > 32 ? 0 : (1 - age / 32) * 0.65;
  });
  const impactRadius = useDerivedValue(() => 12 + Math.max(0, motion.tick.value - motion.impactTick.value) * 0.85);
  const travelerOpacity = state.phase === 'failed' ? 0.3 : 1;
  const patch = useMemo(() => starPath((room.patch?.radius ?? 14) + 2, 5, 0.5), [room.patch?.radius]);
  const heldPocket = room.pockets.find((pocket) => pocket.id === state.pocketId);
  const seam = useMemo(() => {
    const path = Skia.PathBuilder.Make();
    path.moveTo(0, size.height * 0.31).cubicTo(size.width * 0.35, size.height * 0.27, size.width * 0.62, size.height * 0.38, size.width, size.height * 0.3);
    path.moveTo(0, size.height * 0.73).cubicTo(size.width * 0.36, size.height * 0.79, size.width * 0.64, size.height * 0.64, size.width, size.height * 0.7);
    return path.detach();
  }, [size.height, size.width]);
  const boundarySeam = useMemo(() => Skia.PathBuilder.Make()
    .moveTo(offsetX, 0).lineTo(offsetX, floorY)
    .moveTo(offsetX + width * scale, 0).lineTo(offsetX + width * scale, floorY)
    .moveTo(offsetX, floorY).lineTo(offsetX + width * scale, floorY)
    .detach(), [floorY, offsetX, scale, width]);

  return (
    <Canvas
      style={{ width: size.width, height: size.height }}
      accessibilityLabel={`${room.name} fabric playground. ${room.hint}`}
    >
      <FabricTexture width={size.width} height={size.height} highContrast={highContrast} />
      <Path path={seam} style="stroke" strokeWidth={21} color="rgba(253,242,216,0.42)" />
      <Path path={seam} style="stroke" strokeWidth={1} color={highContrast ? '#A08C68' : 'rgba(143,115,80,0.3)'}>
        <DashPathEffect intervals={[4, 5]} />
      </Path>
      <Group clip={{ x: 0, y: 0, width: size.width, height: floorY }}>
        <Group transform={[
          { translateX: offsetX },
          { translateY: offsetY },
          { scale },
        ]}>
          <Group transform={cameraTransform}>
            {room.pockets.filter((pocket) => pocket.motion).map((pocket) => (
              <Line
                key={`track-${pocket.id}`}
                p1={vec(pocket.center.x - pocket.motion!.amplitude, pocket.center.y + 40)}
                p2={vec(pocket.center.x + pocket.motion!.amplitude, pocket.center.y + 40)}
                color={highContrast ? '#7E6439' : 'rgba(135,105,54,0.4)'} strokeWidth={1.2}
              >
                <DashPathEffect intervals={[2, 5]} />
              </Line>
            ))}
            {room.hazards.map((hazard) => <ThornVisual key={hazard.id} hazard={hazard} highContrast={highContrast} />)}
            {room.bumpers.map((bumper) => <BumperVisual key={bumper.id} bumper={bumper} motion={motion} highContrast={highContrast} reducedMotion={reducedMotion} />)}
            {room.patch && !state.patchCollected ? (
              <Group transform={[{ translateX: room.patch.center.x }, { translateY: room.patch.center.y }]}>
                <Circle cx={0} cy={0} r={room.patch.radius + 7} color="rgba(255,246,219,0.8)" />
                <Path path={patch} color="#D29B37" />
                <Path path={patch} style="stroke" strokeWidth={1.5} color={highContrast ? '#5E431C' : '#966B24'} />
                <Circle cx={0} cy={0} r={2.4} color="#FFF6D9" />
              </Group>
            ) : null}
            {room.pockets.map((pocket) => <PocketVisual key={pocket.id} pocket={pocket} state={state} motion={motion} highContrast={highContrast} reducedMotion={reducedMotion} highlighted={pocket.id === nextPocketId} />)}
            {state.phase === 'held' ? <AimVisual room={room} motion={motion} highContrast={highContrast} /> : null}
            <Group opacity={impactOpacity}>
              <Circle cx={motion.impactX} cy={motion.impactY} r={impactRadius} color={palette.frame} style="stroke" strokeWidth={1.5}>
                <DashPathEffect intervals={[2, 5]} />
              </Circle>
            </Group>
            <Group opacity={travelerOpacity}>
              <Traveler x={motion.travelerX} y={motion.travelerY} speed={speed} radius={BUTTON_RADIUS} highContrast={highContrast} />
            </Group>
            {showTutorial && state.phase === 'held' && heldPocket ? (
              <TutorialGesture pocket={heldPocket} motion={motion} reducedMotion={reducedMotion} />
            ) : null}
          </Group>
        </Group>
      </Group>
      <Path path={boundarySeam} style="stroke" strokeWidth={1.4}
        color={highContrast ? palette.frame : 'rgba(49,79,73,0.38)'}>
        <DashPathEffect intervals={[4, 7]} />
      </Path>
    </Canvas>
  );
}
