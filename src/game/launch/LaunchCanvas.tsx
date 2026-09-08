import type { ButtonAppearance } from '../../cosmetics/catalog';
import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Path,
  RoundedRect,
  Skia,
  Text as SkiaText,
  useFont,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { getGamePalette } from '../../theme/gamePalette';
import { Traveler } from '../rendering/Traveler';
import {
  BUTTON_RADIUS,
  LAUNCH_HZ,
  LAUNCH_POWER,
  LAUNCH_STEP_SECONDS,
  MAX_PULL,
  MIN_PULL,
  hazardPosition,
  launchVelocity,
  pocketPosition,
  windAccelerationAt,
} from './simulation';
import type {
  LaunchBumper,
  LaunchHazard,
  LaunchPocket,
  LaunchPickup,
  LaunchRoom,
  LaunchState,
} from './types';
import { getLaunchViewport } from './viewport';
import { WorldBackdrop } from './WorldBackdrop';
import { InteractiveVisuals, OrbitVisual } from './InteractiveVisuals';
import { TOOL_ICON_PATHS, TOOL_ICON_SIZE, TOOL_ICON_STROKE_WIDTH, TOOL_LABELS } from '../../commerce/toolCatalog';
import type { predictEndlessLaunch } from './prediction';

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
  appearance?: ButtonAppearance;
  readonly room: LaunchRoom;
  readonly state: LaunchState;
  readonly motion: LaunchCanvasMotion;
  readonly size: { readonly width: number; readonly height: number };
  readonly highContrast?: boolean;
  readonly reducedMotion?: boolean;
  readonly showTutorial?: boolean;
  /** Screen space reserved below the visible physical floor. */
  readonly bottomInset?: number;
  readonly prediction?: ReturnType<typeof predictEndlessLaunch> | null;
  readonly previewActive?: boolean;
  readonly worldStage?: number;
  readonly worldTransitionTick?: number;
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

function FrayVisual({ pocket, expiry, tick, highContrast }: {
  readonly pocket: LaunchPocket;
  readonly expiry: number | undefined;
  readonly tick: SharedValue<number>;
  readonly highContrast: boolean;
}) {
  const font = useFont(require('@expo-google-fonts/nunito-sans/800ExtraBold/NunitoSans_800ExtraBold.ttf'), 14);
  const ink = highContrast ? '#741C31' : '#8F344C';
  const seconds = useDerivedValue(() => expiry === undefined ? '4'
    : String(Math.max(0, Math.ceil((expiry - tick.value) / LAUNCH_HZ))));
  const remaining = useDerivedValue(() => expiry === undefined ? 1
    : Math.max(0, Math.min(1, (expiry - tick.value) / (pocket.frayTicks ?? 4 * LAUNCH_HZ))));
  const activeOpacity = useDerivedValue(() => expiry !== undefined && tick.value < expiry ? 1 : 0);
  const spentOpacity = useDerivedValue(() => expiry !== undefined && tick.value >= expiry ? 1 : 0);
  const half = pocket.width / 2;
  return <>
    {/* These dangling thread ends warn about the material before first arrival. */}
    <Path path={`M ${-half + 5} 9 q -12 10 -6 18 q 4 7 -5 14 M ${half - 6} 8 q 12 9 5 17 q -4 8 6 15`}
      color={ink} style="stroke" strokeWidth={2} strokeCap="round" />
    <Path path={`M ${-half + 7} 16 l 5 4 M ${-half + 1} 25 l 5 4 M ${half - 7} 16 l -5 4 M ${half - 1} 25 l -5 4`}
      color={ink} style="stroke" strokeWidth={1.2} />
    <Group opacity={activeOpacity} transform={[{ translateX: half + 18 }, { translateY: 14 }]}>
      <Circle cx={0} cy={0} r={15} color="#FFF7E7" />
      <Circle cx={0} cy={0} r={13} color="#DEBAAC" style="stroke" strokeWidth={3} />
      <Path path="M 0 -13 A 13 13 0 1 1 -0.001 -13" end={remaining}
        color={ink} style="stroke" strokeWidth={3} strokeCap="round" />
      {font && <SkiaText x={-4.5} y={5} text={seconds} font={font} color={ink} />}
    </Group>
    <Group opacity={spentOpacity}>
      <Path path={`M ${-half + 4} -3 l ${half - 13} 10 M 9 7 l ${half - 13} -10 M -5 16 l 10 10 M 5 16 l -10 10`}
        color={ink} style="stroke" strokeWidth={2.5} strokeCap="round" />
    </Group>
  </>;
}

function PocketVisual({
  pocket,
  state,
  motion,
  highContrast,
  reducedMotion,
}: {
  readonly pocket: LaunchPocket;
  readonly state: LaunchState;
  readonly motion: LaunchCanvasMotion;
} & VisualPreferences) {
  const occupied = pocket.id === state.pocketId && state.phase === 'held';
  const isGoal = pocket.kind === 'goal';
  const half = pocket.width / 2;
  const temporary = !!pocket.frayTicks;
  const reward = pocket.route === 'reward';
  const fill = temporary ? '#C97F78' : isGoal ? '#D4A63D' : pocket.kind === 'start' ? '#BE5D51' : '#659C97';
  const outline = highContrast
    ? '#392B26'
    : temporary ? '#803E47' : isGoal ? '#8D6924' : pocket.kind === 'start' ? '#823F3A' : '#315E5E';
  const accent = highContrast ? '#302822' : isGoal ? '#FFF1BD' : '#FFF0D7';
  const event = state.event;
  const pocketEventTick = event && 'id' in event && event.id === pocket.id
    && (event.type === 'launch' || event.type === 'catch') ? event.tick : -1000;
  // Capture only the inputs a worklet uses. Capturing the motion object makes
  // Reanimated subscribe it to every shared value, including unrelated flight updates.
  const { tick, pullX, pullY } = motion;
  const expiry = state.pocketExpiryTicks?.[pocket.id];
  const fabricOpacity = useDerivedValue(() => expiry !== undefined && tick.value >= expiry ? 0.17 : 1);
  const stationaryTransform = useMemo(() => [
    { translateX: pocket.center.x }, { translateY: pocket.center.y },
  ], [pocket.center.x, pocket.center.y]);
  const moves = !!(pocket.motion || pocket.orbit);
  const movingX = useDerivedValue(() => moves
    ? pocketPosition(pocket, tick.value).x : pocket.center.x);
  const movingY = useDerivedValue(() => pocket.orbit
    ? pocketPosition(pocket, tick.value).y : pocket.center.y);
  const movingTransform = useDerivedValue(() => [
    { translateX: movingX.value }, { translateY: movingY.value },
  ]);
  // Primitive values stop propagation when an idle pocket's shape is unchanged.
  const deformationX = useDerivedValue(() => occupied ? pullX.value : 0);
  const deformationY = useDerivedValue(() => {
    const age = tick.value - pocketEventTick;
    const snap = !reducedMotion && age >= 0 && age < 55
      ? Math.sin(age * 0.37) * Math.exp(-age / 15) * 10 : 0;
    return (occupied ? pullY.value : 0) + snap;
  });
  const cup = useDerivedValue(() => {
    const x = deformationX.value;
    const y = deformationY.value;
    return Skia.PathBuilder.Make()
      .moveTo(-half, 0)
      .quadTo(0, 5, half, 0)
      .cubicTo(half + 3, 22, x + half * 0.62, y + 34, x, y + 35)
      .cubicTo(x - half * 0.62, y + 34, -half - 3, 22, -half, 0)
      .close().detach();
  });
  const hem = useDerivedValue(() => {
    const x = deformationX.value;
    const y = deformationY.value;
    return Skia.PathBuilder.Make()
      .moveTo(-half + 6, 7)
      .cubicTo(-half + 2, 23, x - half * 0.56, y + 28, x, y + 29)
      .cubicTo(x + half * 0.56, y + 28, half - 2, 23, half - 6, 7)
      .detach();
  });
  const emblemTransform = useDerivedValue(() => [
    { translateX: deformationX.value * 0.55 },
    { translateY: 19 + deformationY.value * 0.6 },
  ]);
  const diamond = useMemo(() => starPath(6, 4, 0.65), []);
  const rewardStar = useMemo(() => starPath(7, 5, 0.45), []);

  return (
    <Group transform={moves ? movingTransform : stationaryTransform}>
      <Group opacity={fabricOpacity}>
      {isGoal ? (
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
        {temporary ? <Path path="M -5 -7 L 5 -7 L -5 7 L 5 7 L -5 -7 M -5 -7 L 5 -7 M -5 7 L 5 7"
          color={accent} style="stroke" strokeWidth={1.6} strokeJoin="round" />
          : reward ? <Path path={rewardStar} color={accent} />
            : pocket.route === 'safe' || pocket.route === 'recovery' ? <>
              <Path path="M -8 -4 l 4 4 l 5 -6 M 0 4 l 4 4 l 5 -6" color={accent} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" />
            </> : isGoal ? <Path path={diamond} color={accent} /> : (
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
      {temporary && <FrayVisual pocket={pocket} expiry={expiry} tick={tick} highContrast={highContrast} />}
    </Group>
  );
}

function BumperVisual({ bumper, motion, highContrast, reducedMotion }: {
  readonly bumper: LaunchBumper;
  readonly motion: LaunchCanvasMotion;
} & VisualPreferences) {
  const { radius } = bumper;
  const { tick, impactTick, impactX, impactY } = motion;
  const compression = useDerivedValue(() => {
    const age = tick.value - impactTick.value;
    const nearby = Math.hypot(impactX.value - bumper.center.x, impactY.value - bumper.center.y)
      < radius + BUTTON_RADIUS + 8;
    return !reducedMotion && nearby && age >= 0 && age < 35
      ? Math.sin(age * 0.36) * Math.exp(-age / 10) * 0.16 : 0;
  });
  const transform = useDerivedValue(() => [
    { translateX: bumper.center.x }, { translateY: bumper.center.y },
    { scaleX: 1 + compression.value }, { scaleY: 1 - compression.value },
  ]);
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
      {bumper.springSpeed !== undefined ? <>
        <Circle cx={0} cy={0} r={radius} color={highContrast ? '#F9E7CE' : '#EAC69C'} />
        <Circle cx={0} cy={0} r={radius - 1} color={highContrast ? '#5C3829' : '#92613F'} style="stroke" strokeWidth={2} />
        <Circle cx={0} cy={0} r={radius - 5} color="#FFF1D8" style="stroke" strokeWidth={1.4}>
          <DashPathEffect intervals={[3, 3]} />
        </Circle>
        <RoundedRect x={-8} y={-11} width={16} height={22} r={3} color="#B78660" />
        <RoundedRect x={-13} y={-13} width={26} height={5} r={2.5} color={highContrast ? '#5C3829' : '#805337'} />
        <RoundedRect x={-13} y={8} width={26} height={5} r={2.5} color={highContrast ? '#5C3829' : '#805337'} />
        <Path path="M -6 -8 L 6 -5 L -6 -1 L 6 3 L -6 7" color="#FFF3D9" style="stroke" strokeWidth={2.4} strokeJoin="round" />
      </> : <>
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
      </>}
    </Group>
  );
}

function ThornVisual({ hazard, motion, highContrast, reducedMotion }: {
  readonly hazard: LaunchHazard;
  readonly motion: LaunchCanvasMotion;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}) {
  // Outer points match the circular collision boundary; the darker inner disc
  // makes the dangerous surface readable without relying on red alone.
  const outline = useMemo(() => starPath(hazard.radius, 9, 0.69), [hazard.radius]);
  const { tick } = motion;
  const movingX = useDerivedValue(() => hazard.motion ? hazardPosition(hazard, tick.value).x : hazard.center.x);
  const movingY = useDerivedValue(() => hazard.motion ? hazardPosition(hazard, tick.value).y : hazard.center.y);
  const transform = useDerivedValue(() => [
    { translateX: movingX.value }, { translateY: movingY.value },
  ]);
  const horizontal = hazard.motion?.axis !== 'y';
  const travelX = horizontal ? hazard.motion?.amplitude ?? 0 : 0;
  const travelY = horizontal ? 0 : hazard.motion?.amplitude ?? 0;
  const snip = useDerivedValue(() => reducedMotion || hazard.visual !== 'scissors'
    ? 0 : Math.sin(tick.value / LAUNCH_HZ * Math.PI * 2) * 0.13);
  const bladeRotation = useDerivedValue(() => [{ rotate: snip.value }]);
  const otherBladeRotation = useDerivedValue(() => [{ scaleX: -1 }, { rotate: snip.value }]);
  return (
    <>
    {hazard.motion && <Group>
      <Line p1={vec(hazard.center.x - travelX, hazard.center.y - travelY)}
        p2={vec(hazard.center.x + travelX, hazard.center.y + travelY)}
        color={highContrast ? '#803648' : '#B16D70'} strokeWidth={2}>
        <DashPathEffect intervals={[3, 5]} />
      </Line>
      {[-1, 1].map((direction) => <Circle key={direction} cx={hazard.center.x + travelX * direction}
        cy={hazard.center.y + travelY * direction} r={3} color="#803648" />)}
    </Group>}
    <Group transform={hazard.motion ? transform : [{ translateX: hazard.center.x }, { translateY: hazard.center.y }]}>
      {hazard.visual === 'scissors' ? <>
        <Circle cx={0} cy={0} r={hazard.radius} color={highContrast ? '#71162E' : '#994456'} />
        <Circle cx={0} cy={0} r={hazard.radius - 0.75} color={highContrast ? '#320F1B' : '#612F43'} style="stroke" strokeWidth={1.5} />
        {/* Blades and handles remain inside the marked circular collision footprint. */}
        <Group transform={[{ scale: hazard.radius / 18 }]}>
          {[bladeRotation, otherBladeRotation].map((rotation, index) => <Group key={index} transform={rotation}>
            <Path path="M -2 2 L 10 -10 Q 12 -7 2 3 Z" color="#F8EEDC" />
            <Circle cx={-6} cy={7} r={4} color="#F8EEDC" style="stroke" strokeWidth={2} />
            <Line p1={vec(-4, 4)} p2={vec(0, 0)} color="#F8EEDC" strokeWidth={2} />
          </Group>)}
          <Circle cx={0} cy={0} r={2} color="#E5B9A3" />
        </Group>
      </> : <>
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
      </>}
    </Group>
    </>
  );
}

function AimVisual({ room, pocket, motion, highContrast, extended = false }: {
  readonly room: LaunchRoom;
  readonly pocket: LaunchPocket | undefined;
  readonly motion: LaunchCanvasMotion;
  readonly highContrast: boolean;
  readonly extended?: boolean;
}) {
  const { travelerX, travelerY, pullX, pullY, tick } = motion;
  const opacity = useDerivedValue(() => Math.hypot(pullX.value, pullY.value) >= MIN_PULL ? 1 : 0);
  // Ordinary pockets do not subscribe their guides to the simulation clock.
  // An orbit carries tangential momentum through the actual release tick.
  const releaseTick = useDerivedValue(() => pocket?.orbit ? tick.value : 0);
  const velocity = useDerivedValue(() => pocket
    ? launchVelocity(pocket, releaseTick.value, { x: pullX.value, y: pullY.value })
    : { x: -pullX.value * LAUNCH_POWER, y: -pullY.value * LAUNCH_POWER });
  const trajectory = useDerivedValue(() => {
    const path = Skia.PathBuilder.Make();
    const x = travelerX.value;
    const y = travelerY.value;
    let vx = velocity.value.x;
    let vy = velocity.value.y;
    path.moveTo(x, y);
    if (room.windZones?.length) {
      const position = { x, y };
      // Match flight's once-per-tick wind kick and exact vertical integration.
      for (let index = 1; index <= 34; index += 1) {
        vx += windAccelerationAt(room.windZones, position) * LAUNCH_STEP_SECONDS;
        position.x += vx * LAUNCH_STEP_SECONDS;
        position.y += vy * LAUNCH_STEP_SECONDS + 0.5 * room.gravity * LAUNCH_STEP_SECONDS * LAUNCH_STEP_SECONDS;
        vy += room.gravity * LAUNCH_STEP_SECONDS;
        if (index % 2 === 0) path.lineTo(position.x, position.y);
      }
      return path.detach();
    }
    // Only the first 0.28 seconds: the player still discovers the route.
    for (let index = 1; index <= 14; index += 1) {
      const t = index * 0.02;
      path.lineTo(x + vx * t, y + vy * t + 0.5 * room.gravity * t * t);
    }
    return path.detach();
  });
  const arrow = useDerivedValue(() => {
    const dx = velocity.value.x;
    const dy = velocity.value.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const tipX = travelerX.value + ux * 25;
    const tipY = travelerY.value + uy * 25;
    return Skia.PathBuilder.Make()
      .moveTo(tipX - ux * 7 - uy * 4, tipY - uy * 7 + ux * 4)
      .lineTo(tipX, tipY)
      .lineTo(tipX - ux * 7 + uy * 4, tipY - uy * 7 - ux * 4)
      .detach();
  });
  const power = useDerivedValue(() => Math.min(1, Math.hypot(pullX.value, pullY.value) / MAX_PULL));
  const powerWidth = useDerivedValue(() => Math.max(0.1, power.value * 34));
  const powerTransform = useDerivedValue(() => [
    { translateX: travelerX.value - 19 },
    { translateY: travelerY.value + 20 },
  ]);
  const color = highContrast ? '#193D49' : '#315D65';
  return (
    <Group opacity={opacity}>
      {!extended && <Path path={trajectory} style="stroke" strokeWidth={2} color={color} strokeCap="round">
        <DashPathEffect intervals={[2, 7]} />
      </Path>}
      <Path path={arrow} style="stroke" strokeWidth={2} color={color} strokeCap="round" strokeJoin="round" />
      <Group transform={powerTransform}>
        <RoundedRect x={0} y={0} width={38} height={7} r={3.5} color="#FFF2D8" />
        <RoundedRect x={0} y={0} width={38} height={7} r={3.5} color={color} style="stroke" strokeWidth={1} />
        <RoundedRect x={2} y={2} width={powerWidth} height={3} r={1.5} color={color} />
      </Group>
    </Group>
  );
}

function WindVisual({ zone, highContrast }: {
  readonly zone: NonNullable<LaunchRoom['windZones']>[number];
  readonly highContrast: boolean;
}) {
  const ink = highContrast ? '#275B79' : '#648BA6';
  const ribbons = useMemo(() => Array.from({ length: 4 }, (_, index) => 23 + index * (zone.height - 46) / 3), [zone.height]);
  const direction = zone.accelerationX < 0 ? -1 : 1;
  return <Group transform={[{ translateX: zone.x }, { translateY: zone.y }]}>
    <RoundedRect x={0} y={0} width={zone.width} height={zone.height} r={12} color={highContrast ? 'rgba(233,246,255,0.8)' : 'rgba(244,251,255,0.4)'} />
    <RoundedRect x={0} y={0} width={zone.width} height={zone.height} r={12} color={ink} style="stroke" strokeWidth={highContrast ? 1.8 : 1.2}>
      <DashPathEffect intervals={[4, 5]} />
    </RoundedRect>
    <Group transform={[{ translateX: direction < 0 ? zone.width : 0 }, { scaleX: direction }]}>
      {ribbons.map((y) => <Group key={y}>
        <Path path={`M 13 ${y} C 34 ${y - 8} 48 ${y + 8} ${zone.width - 16} ${y}`}
          color={ink} style="stroke" strokeWidth={2} strokeCap="round" />
        <Path path={`M ${zone.width - 22} ${y - 5} L ${zone.width - 16} ${y} L ${zone.width - 23} ${y + 5}`}
          color={ink} style="stroke" strokeWidth={2} strokeCap="round" strokeJoin="round" />
      </Group>)}
    </Group>
  </Group>;
}

function PickupVisual({ pickup, highContrast }: { pickup: LaunchPickup; highContrast: boolean }) {
  const font = useFont(require('@expo-google-fonts/nunito-sans/800ExtraBold/NunitoSans_800ExtraBold.ttf'), 8);
  const label = TOOL_LABELS[pickup.kind];
  const width = font ? font.getGlyphWidths(font.getGlyphIDs(label)).reduce((sum, value) => sum + value, 0) : 30;
  const ink = highContrast ? '#183f36' : '#28594b';
  return <Group transform={[{ translateX: pickup.center.x }, { translateY: pickup.center.y }]}>
    <Circle cx={1} cy={3} r={pickup.radius + 1} color="rgba(46,67,47,0.19)" />
    <Circle cx={0} cy={0} r={pickup.radius} color={pickup.kind === 'revive' ? '#f5cfca' : pickup.kind === 'preview' ? '#e0e9bc' : '#c3e3df'} />
    <Circle cx={0} cy={0} r={pickup.radius} color={ink} strokeWidth={1.2} style="stroke"><DashPathEffect intervals={[2, 2]} /></Circle>
    <Group transform={[{ translateX: -TOOL_ICON_SIZE / 2 }, { translateY: -TOOL_ICON_SIZE / 2 }]}>
      <Path path={TOOL_ICON_PATHS[pickup.kind]} color={ink} style="stroke" strokeWidth={TOOL_ICON_STROKE_WIDTH}
        strokeCap="round" strokeJoin="round" />
    </Group>
    {font && <Group>
      <RoundedRect x={-width / 2 - 5} y={pickup.radius + 3} width={width + 10} height={13} r={4} color="#fff8e7" />
      <SkiaText x={-width / 2} y={pickup.radius + 12} text={label} font={font} color={ink} />
    </Group>}
  </Group>;
}

function PredictionVisual({ prediction }: { prediction: NonNullable<LaunchCanvasProps['prediction']> }) {
  const path = useMemo(() => {
    const result = Skia.PathBuilder.Make();
    prediction.points.forEach((point, index) => { if (index === 0) result.moveTo(point.x, point.y); else result.lineTo(point.x, point.y); });
    return result.detach();
  }, [prediction.points]);
  const last = prediction.points.at(-1);
  const ink = prediction.outcome === 'fail' ? '#8f344c' : '#28594b';
  return <Group>
    <Path path={path} color="#fff8e7" strokeWidth={5} style="stroke" strokeCap="round" opacity={0.8} />
    <Path path={path} color={ink} strokeWidth={2} style="stroke" strokeCap="round"><DashPathEffect intervals={[3, 4]} /></Path>
    {prediction.bounces.map((bounce, index) => <Circle key={index} cx={bounce.x} cy={bounce.y} r={10} color={ink} style="stroke" strokeWidth={2} />)}
    {last && <Group transform={[{ translateX: last.x }, { translateY: last.y }]}>
      <Circle cx={0} cy={0} r={11} color="#fff8e7" />
      <Circle cx={0} cy={0} r={11} color={ink} style="stroke" strokeWidth={1.5} />
      {prediction.outcome === 'catch' ? <Path path="M -5 0 L -1 4 L 6 -4" color={ink} style="stroke" strokeWidth={2} strokeCap="round" />
        : prediction.outcome === 'fail' ? <Path path="M -4 -4 L 4 4 M 4 -4 L -4 4" color={ink} style="stroke" strokeWidth={2} />
          : [-5, 0, 5].map((x) => <Circle key={x} cx={x} cy={0} r={1.3} color={ink} />)}
    </Group>}
  </Group>;
}

function TutorialGesture({ pocket, motion, reducedMotion }: {
  readonly pocket: LaunchPocket;
  readonly motion: LaunchCanvasMotion;
  readonly reducedMotion: boolean;
}) {
  const { tick, pullX, pullY } = motion;
  const gesturePull = useDerivedValue(() => {
    const cycle = (tick.value / LAUNCH_HZ) % 2.6;
    return reducedMotion ? 0.72 : Math.min(1, Math.max(0, (cycle - 0.3) / 1.2));
  });
  const transform = useDerivedValue(() => [
    { translateX: pocket.center.x - gesturePull.value * 24 },
    { translateY: pocket.center.y + gesturePull.value * 72 },
  ]);
  const opacity = useDerivedValue(() => {
    if (Math.hypot(pullX.value, pullY.value) > 3) return 0;
    if (reducedMotion) return 0.6;
    const cycle = (tick.value / LAUNCH_HZ) % 2.6;
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

/** Padded edges sit on the collision planes and remain still as the fabric scrolls. */
function SideWallVisual({ x, height, scale, highContrast }: {
  readonly x: number;
  readonly height: number;
  readonly scale: number;
  readonly highContrast: boolean;
}) {
  const half = 7 * scale;
  const ink = highContrast ? '#243F37' : '#54756B';
  const sections = useMemo(() => Array.from({ length: Math.ceil(height / (34 * scale)) }, (_, index) =>
    (index + 0.5) * 34 * scale), [height, scale]);
  return <Group clip={{ x: x - half - 2, y: 0, width: half * 2 + 4, height }}>
    <RoundedRect x={x - half} y={-half} width={half * 2} height={height + half * 2} r={half}
      color={highContrast ? '#C9D9BA' : '#ABC0A8'} />
    <RoundedRect x={x - half} y={-half} width={half * 2} height={height + half * 2} r={half}
      color={ink} style="stroke" strokeWidth={highContrast ? 2 : 1.5} />
    <Line p1={vec(x, 0)} p2={vec(x, height)} color={highContrast ? ink : '#F9F0D5'} strokeWidth={1.4}>
      <DashPathEffect intervals={[3 * scale, 4 * scale]} />
    </Line>
    {sections.map((y) => <Line key={y} p1={vec(x - half + scale, y)} p2={vec(x + half - scale, y)}
      color={ink} strokeWidth={1} opacity={highContrast ? 1 : 0.6} />)}
  </Group>;
}

export function LaunchCanvas({
  appearance,
  room,
  state,
  motion,
  size,
  highContrast = false,
  reducedMotion = false,
  showTutorial = false,
  bottomInset = 0,
  prediction,
  previewActive = false,
  worldStage = 0,
  worldTransitionTick,
}: LaunchCanvasProps) {
  const palette = getGamePalette(highContrast);
  const width = room.bounds.width;
  const { scale, offsetX, offsetY } = getLaunchViewport(size, room.bounds, bottomInset);
  const floorY = size.height - bottomInset;
  const { cameraY, tick, impactTick } = motion;
  const cameraTransform = useDerivedValue(() => [
    { translateY: -(cameraY?.value ?? 0) },
  ]);
  const speed = useDerivedValue<number>(() => state.phase === 'flying' && !reducedMotion ? 0.6 : 0);
  const impactOpacity = useDerivedValue(() => {
    const age = tick.value - impactTick.value;
    return reducedMotion || impactTick.value < 0 || age < 0 || age > 32 ? 0 : (1 - age / 32) * 0.65;
  });
  const impactRadius = useDerivedValue(() => {
    if (reducedMotion || impactTick.value < 0) return 12;
    return 12 + Math.min(32, Math.max(0, tick.value - impactTick.value)) * 0.85;
  });
  const travelerOpacity = state.phase === 'failed' ? 0.3 : 1;
  const patch = useMemo(() => starPath((room.patch?.radius ?? 14) + 2, 5, 0.5), [room.patch?.radius]);
  const heldPocket = room.pockets.find((pocket) => pocket.id === state.pocketId);
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
      <WorldBackdrop width={size.width} height={size.height} highContrast={highContrast} reducedMotion={reducedMotion}
        tick={tick} worldStage={worldStage} worldTransitionTick={worldTransitionTick} />
      <Group clip={{ x: 0, y: 0, width: size.width, height: floorY }}>
        <Group transform={[
          { translateX: offsetX },
          { translateY: offsetY },
          { scale },
        ]}>
          <Group transform={cameraTransform}>
            {room.windZones?.map((zone) => <WindVisual key={zone.id} zone={zone} highContrast={highContrast} />)}
            {room.pockets.filter((pocket) => pocket.orbit).map((pocket) => <OrbitVisual key={`orbit-${pocket.id}`}
              pocket={pocket} tick={tick} highContrast={highContrast} />)}
            <InteractiveVisuals room={room} state={state} tick={tick} highContrast={highContrast} reducedMotion={reducedMotion} />
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
            {room.hazards.map((hazard) => <ThornVisual key={hazard.id} hazard={hazard} motion={motion} highContrast={highContrast} reducedMotion={reducedMotion} />)}
            {room.bumpers.map((bumper) => <BumperVisual key={bumper.id} bumper={bumper} motion={motion} highContrast={highContrast} reducedMotion={reducedMotion} />)}
            {room.pickups?.filter((pickup) => !state.pickupIds.includes(pickup.id)).map((pickup) => <PickupVisual key={pickup.id} pickup={pickup} highContrast={highContrast} />)}
            {room.patch && !state.patchCollected ? (
              <Group transform={[{ translateX: room.patch.center.x }, { translateY: room.patch.center.y }]}>
                <Circle cx={0} cy={0} r={room.patch.radius + 7} color="rgba(255,246,219,0.8)" />
                <Path path={patch} color="#D29B37" />
                <Path path={patch} style="stroke" strokeWidth={1.5} color={highContrast ? '#5E431C' : '#966B24'} />
                <Circle cx={0} cy={0} r={2.4} color="#FFF6D9" />
              </Group>
            ) : null}
            {room.pockets.map((pocket) => <PocketVisual key={pocket.id} pocket={pocket} state={state} motion={motion} highContrast={highContrast} reducedMotion={reducedMotion} />)}
            {state.phase === 'held' ? <AimVisual room={room} pocket={heldPocket} motion={motion} highContrast={highContrast} extended={previewActive && !!prediction} /> : null}
            {state.phase === 'held' && previewActive && prediction && <PredictionVisual prediction={prediction} />}
            <Group opacity={impactOpacity}>
              <Circle cx={motion.impactX} cy={motion.impactY} r={impactRadius} color={palette.frame} style="stroke" strokeWidth={1.5}>
                <DashPathEffect intervals={[2, 5]} />
              </Circle>
            </Group>
            <Group opacity={travelerOpacity}>
              <Traveler appearance={appearance} x={motion.travelerX} y={motion.travelerY} speed={speed} radius={BUTTON_RADIUS} highContrast={highContrast} />
            </Group>
            {showTutorial && state.phase === 'held' && heldPocket ? (
              <TutorialGesture pocket={heldPocket} motion={motion} reducedMotion={reducedMotion} />
            ) : null}
          </Group>
        </Group>
      </Group>
      {room.sideWallRestitution !== undefined ? <>
        {[offsetX, offsetX + width * scale].map((x) => <SideWallVisual key={x} x={x} height={floorY} scale={scale} highContrast={highContrast} />)}
        <Line p1={vec(offsetX, floorY)} p2={vec(offsetX + width * scale, floorY)}
          color={highContrast ? palette.frame : 'rgba(49,79,73,0.38)'} strokeWidth={1.4}>
          <DashPathEffect intervals={[4, 7]} />
        </Line>
      </> : <Path path={boundarySeam} style="stroke" strokeWidth={1.4}
        color={highContrast ? palette.frame : 'rgba(49,79,73,0.38)'}>
        <DashPathEffect intervals={[4, 7]} />
      </Path>}
    </Canvas>
  );
}
