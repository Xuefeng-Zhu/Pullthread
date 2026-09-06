import {
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  Path,
  Rect,
  RoundedRect,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import {
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import type { HeightField } from '../core/heightField';
import type { Point, SimulationPhase, Stitch } from '../core/types';
import type { CanvasSize } from '../input/stitchGesture';
import type { LevelDefinition } from '../levels/schema';
import { FabricTexture } from './FabricTexture';
import { GoalRenderer } from './GoalRenderer';
import { StitchRenderer } from './StitchRenderer';
import { Traveler } from './Traveler';
import { toCanvasPoint, worldRadiusToPixels } from './coordinates';
import { getGamePalette } from '../../theme/gamePalette';

interface FabricCanvasProps {
  readonly level: LevelDefinition;
  readonly size: CanvasSize;
  readonly field: HeightField;
  readonly stitches: readonly Stitch[];
  readonly preview: Stitch | null;
  readonly route: readonly Point[];
  readonly routeSucceeds: boolean;
  readonly phase: SimulationPhase;
  readonly travelerX: SharedValue<number>;
  readonly travelerY: SharedValue<number>;
  readonly travelerSpeed: SharedValue<number>;
  readonly highContrast?: boolean;
  readonly showRoute?: boolean;
  readonly stitchProgress?: SharedValue<number>;
}

function createDeformedGridPath(field: HeightField, size: CanvasSize) {
  const path = Skia.PathBuilder.Make();
  const bounds = field.bounds;
  const heightScale = (size.height / bounds.height) * 0.55;

  const mappedVertex = (column: number, row: number) => {
    const index = row * field.columns + column;
    const x =
      bounds.x + column * field.cellWidth + field.offsetX[index];
    const y =
      bounds.y + row * field.cellHeight + field.offsetY[index];
    const point = toCanvasPoint({ x, y }, size, bounds);
    const raisedHeight = field.heights[index] - field.baseHeights[index];
    return { x: point.x, y: point.y - raisedHeight * heightScale };
  };

  for (let row = 0; row < field.rows; row += 4) {
    for (let column = 0; column < field.columns; column += 1) {
      const point = mappedVertex(column, row);
      if (column === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    }
  }

  for (let column = 0; column < field.columns; column += 4) {
    for (let row = 0; row < field.rows; row += 1) {
      const point = mappedVertex(column, row);
      if (row === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    }
  }

  return path.detach();
}

function createRoutePath(
  points: readonly Point[],
  size: CanvasSize,
  bounds: LevelDefinition['fabricBounds'],
) {
  const path = Skia.PathBuilder.Make();
  points.forEach((point, index) => {
    const mapped = toCanvasPoint(point, size, bounds);
    if (index === 0) path.moveTo(mapped.x, mapped.y);
    else path.lineTo(mapped.x, mapped.y);
  });
  return path.detach();
}

export function FabricCanvas({
  level,
  size,
  field,
  stitches,
  preview,
  route,
  routeSucceeds,
  phase,
  travelerX,
  travelerY,
  travelerSpeed,
  highContrast = false,
  showRoute,
  stitchProgress,
}: FabricCanvasProps) {
  const palette = getGamePalette(highContrast);
  const fullStitchProgress = useSharedValue(1);
  const deformedGrid = useMemo(
    () => createDeformedGridPath(field, size),
    [field, size],
  );
  const routePath = useMemo(
    () => createRoutePath(route, size, level.fabricBounds),
    [level.fabricBounds, route, size],
  );
  const mappedStitches = useMemo(
    () =>
      [...stitches, ...(preview ? [preview] : [])].map((stitch) => ({
        id: stitch.id,
        type: stitch.type,
        start: toCanvasPoint(stitch.start, size, level.fabricBounds),
        end: toCanvasPoint(stitch.end, size, level.fabricBounds),
        radius: worldRadiusToPixels(
          level.stitchInfluenceRadii[stitch.type],
          size,
          level.fabricBounds,
        ),
        preview: stitch.id === preview?.id,
      })),
    [
      level.fabricBounds,
      level.stitchInfluenceRadii,
      preview,
      size,
      stitches,
    ],
  );
  const goalCenter = toCanvasPoint(
    level.goal.center,
    size,
    level.fabricBounds,
  );
  const goalRadius = worldRadiusToPixels(
    level.goal.radius,
    size,
    level.fabricBounds,
  );
  const travelerRadius = worldRadiusToPixels(
    level.traveler.radius,
    size,
    level.fabricBounds,
  );
  const canvasTravelerX = useDerivedValue(
    () =>
      ((travelerX.value - level.fabricBounds.x) /
        level.fabricBounds.width) *
      size.width,
  );
  const canvasTravelerY = useDerivedValue(
    () =>
      ((travelerY.value - level.fabricBounds.y) /
        level.fabricBounds.height) *
      size.height,
  );
  const inset = 7;
  const materialTypes = [
    ...new Set(level.fabricRegions.map((region) => region.type)),
  ];
  const materialDescription =
    materialTypes.length > 0
      ? ` Material regions: ${materialTypes.join(', ')}.`
      : '';

  return (
    <Canvas
      style={{ width: size.width, height: size.height }}
      accessibilityLabel={`Quilt playfield.${materialDescription} Drag across the fabric to place a stitch.`}
    >
      <FabricTexture
        width={size.width}
        height={size.height}
        highContrast={highContrast}
      />

      {level.fabricRegions.map((region) => {
        const topLeft = toCanvasPoint(
          { x: region.bounds.x, y: region.bounds.y },
          size,
          level.fabricBounds,
        );
        const bottomRight = toCanvasPoint(
          {
            x: region.bounds.x + region.bounds.width,
            y: region.bounds.y + region.bounds.height,
          },
          size,
          level.fabricBounds,
        );
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;
        const fill =
          region.type === 'felt'
            ? highContrast
              ? 'rgba(40,75,48,0.48)'
              : 'rgba(83,112,91,0.32)'
            : region.type === 'silk'
              ? highContrast
                ? 'rgba(34,77,122,0.45)'
                : 'rgba(111,145,176,0.3)'
              : highContrast
                ? 'rgba(139,62,36,0.44)'
                : 'rgba(196,124,92,0.28)';
        const patternColor = highContrast
          ? '#fffdf4'
          : region.type === 'felt'
            ? '#36583f'
            : region.type === 'silk'
              ? '#315f86'
              : '#914a31';
        const strokeWidth = highContrast ? 2.4 : 1.5;
        return (
          <Group key={region.id}>
            <Rect
              x={topLeft.x}
              y={topLeft.y}
              width={width}
              height={height}
              color={fill}
            />
            <Rect
              x={topLeft.x}
              y={topLeft.y}
              width={width}
              height={height}
              style="stroke"
              strokeWidth={strokeWidth}
              color={patternColor}
            />

            {region.type === 'felt'
              ? Array.from({ length: 8 }, (_, index) => (
                  <Circle
                    key={`${region.id}-dot-${index}`}
                    cx={topLeft.x + (width * ((index % 4) + 0.5)) / 4}
                    cy={topLeft.y + (height * (Math.floor(index / 4) + 0.5)) / 2}
                    r={Math.max(1.5, Math.min(width, height) * 0.025)}
                    color={patternColor}
                  />
                ))
              : null}

            {region.type === 'silk'
              ? Array.from({ length: 5 }, (_, index) => (
                  <Line
                    key={`${region.id}-sheen-${index}`}
                    p1={vec(topLeft.x + (width * index) / 6, bottomRight.y)}
                    p2={vec(
                      topLeft.x + (width * (index + 2)) / 6,
                      topLeft.y,
                    )}
                    strokeWidth={strokeWidth}
                    color={patternColor}
                  />
                ))
              : null}

            {region.type === 'elastic'
              ? Array.from({ length: 4 }, (_, index) => {
                  const centerY =
                    topLeft.y + (height * (index + 1)) / 5;
                  const flex = Math.min(height / 18, 5);
                  return (
                    <Group key={`${region.id}-spring-${index}`}>
                      <Line
                        p1={vec(topLeft.x, centerY)}
                        p2={vec(topLeft.x + width / 2, centerY - flex)}
                        strokeWidth={strokeWidth}
                        color={patternColor}
                      />
                      <Line
                        p1={vec(topLeft.x + width / 2, centerY - flex)}
                        p2={vec(bottomRight.x, centerY)}
                        strokeWidth={strokeWidth}
                        color={patternColor}
                      />
                    </Group>
                  );
                })
              : null}
          </Group>
        );
      })}

      <Path
        path={deformedGrid}
        style="stroke"
        strokeWidth={1.25}
        color={palette.grid}
      >
        <DashPathEffect intervals={[5, 8]} />
      </Path>

      {(showRoute ?? phase === 'planning') && route.length > 1 ? (
        <Path
          path={routePath}
          style="stroke"
          strokeWidth={5}
          strokeCap="round"
          color={
            routeSucceeds
              ? palette.routeSuccess
              : palette.routeFailure
          }
        >
          <DashPathEffect intervals={[1, 11]} />
        </Path>
      ) : null}

      <GoalRenderer
        center={goalCenter}
        radius={goalRadius}
        highlighted={phase === 'succeeded'}
        highContrast={highContrast}
      />

      {level.hazards.map((hazard) => {
        const center = toCanvasPoint(
          hazard.center,
          size,
          level.fabricBounds,
        );
        const radius = worldRadiusToPixels(
          hazard.radius,
          size,
          level.fabricBounds,
        );
        return (
          <Group key={hazard.id}>
            <Circle
              cx={center.x}
              cy={center.y}
              r={radius}
              color={hazard.type === 'hole' ? '#49392f' : '#8a3439'}
            />
            <Circle
              cx={center.x}
              cy={center.y}
              r={Math.max(2, radius * 0.58)}
              color={hazard.type === 'hole' ? '#171f22' : '#d79a78'}
            />
          </Group>
        );
      })}

      {level.bumpers.map((bumper) => {
        const center = toCanvasPoint(
          bumper.center,
          size,
          level.fabricBounds,
        );
        const radius = worldRadiusToPixels(
          bumper.radius,
          size,
          level.fabricBounds,
        );
        return (
          <Group key={bumper.id}>
            <Circle cx={center.x} cy={center.y + 3} r={radius} color="rgba(49,43,37,0.28)" />
            <Circle cx={center.x} cy={center.y} r={radius} color="#c47f55" />
            <Circle cx={center.x - radius * 0.2} cy={center.y - radius * 0.2} r={Math.max(2, radius * 0.22)} color="#f2c89f" />
          </Group>
        );
      })}

      {level.collectible ? (() => {
        const center = toCanvasPoint(
          level.collectible.center,
          size,
          level.fabricBounds,
        );
        const radius = worldRadiusToPixels(
          level.collectible.radius,
          size,
          level.fabricBounds,
        );
        return (
          <Group>
            <Circle cx={center.x} cy={center.y} r={radius} color="#d29d2f" />
            <Circle cx={center.x} cy={center.y} r={Math.max(2, radius * 0.48)} color="#f5df91" />
          </Group>
        );
      })() : null}
      <StitchRenderer
        stitches={mappedStitches}
        highContrast={highContrast}
        progress={stitchProgress ?? fullStitchProgress}
      />

      <Group opacity={0.54}>
        <Line
          p1={vec(size.width * 0.12, size.height * 0.76)}
          p2={vec(size.width * 0.16, size.height * 0.8)}
          color="#315d5f"
          strokeWidth={2}
        />
        <Line
          p1={vec(size.width * 0.16, size.height * 0.76)}
          p2={vec(size.width * 0.12, size.height * 0.8)}
          color="#315d5f"
          strokeWidth={2}
        />
        <Circle
          cx={size.width * 0.82}
          cy={size.height * 0.2}
          r={3}
          color="#b98a2f"
        />
      </Group>

      <Traveler
        x={canvasTravelerX}
        y={canvasTravelerY}
        speed={travelerSpeed}
        radius={travelerRadius}
        highContrast={highContrast}
      />

      <RoundedRect
        x={inset}
        y={inset}
        width={size.width - inset * 2}
        height={size.height - inset * 2}
        r={18}
        color={palette.frame}
        style="stroke"
        strokeWidth={5}
      />
      <Rect
        x={inset + 6}
        y={inset + 6}
        width={size.width - (inset + 6) * 2}
        height={size.height - (inset + 6) * 2}
        color="rgba(255,255,255,0)"
        style="stroke"
        strokeWidth={1.5}
      />
    </Canvas>
  );
}
