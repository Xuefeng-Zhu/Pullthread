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
import { SPIKE_LEVEL } from '../levels/spikeLevel';
import { FabricTexture } from './FabricTexture';
import { GoalRenderer } from './GoalRenderer';
import { StitchRenderer } from './StitchRenderer';
import { Traveler } from './Traveler';
import { toCanvasPoint, worldRadiusToPixels } from './coordinates';
import { getGamePalette } from '../../theme/gamePalette';

interface FabricCanvasProps {
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

function createRoutePath(points: readonly Point[], size: CanvasSize) {
  const path = Skia.PathBuilder.Make();
  points.forEach((point, index) => {
    const mapped = toCanvasPoint(point, size, SPIKE_LEVEL.fabricBounds);
    if (index === 0) path.moveTo(mapped.x, mapped.y);
    else path.lineTo(mapped.x, mapped.y);
  });
  return path.detach();
}

export function FabricCanvas({
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
    () => createRoutePath(route, size),
    [route, size],
  );
  const mappedStitches = useMemo(
    () =>
      [...stitches, ...(preview ? [preview] : [])].map((stitch) => ({
        id: stitch.id,
        start: toCanvasPoint(stitch.start, size, SPIKE_LEVEL.fabricBounds),
        end: toCanvasPoint(stitch.end, size, SPIKE_LEVEL.fabricBounds),
        radius: worldRadiusToPixels(
          stitch.radius,
          size,
          SPIKE_LEVEL.fabricBounds,
        ),
        preview: stitch.id === preview?.id,
      })),
    [preview, size, stitches],
  );
  const goalCenter = toCanvasPoint(
    SPIKE_LEVEL.goal.center,
    size,
    SPIKE_LEVEL.fabricBounds,
  );
  const goalRadius = worldRadiusToPixels(
    SPIKE_LEVEL.goal.radius,
    size,
    SPIKE_LEVEL.fabricBounds,
  );
  const travelerRadius = worldRadiusToPixels(
    SPIKE_LEVEL.traveler.radius,
    size,
    SPIKE_LEVEL.fabricBounds,
  );
  const canvasTravelerX = useDerivedValue(
    () =>
      ((travelerX.value - SPIKE_LEVEL.fabricBounds.x) /
        SPIKE_LEVEL.fabricBounds.width) *
      size.width,
  );
  const canvasTravelerY = useDerivedValue(
    () =>
      ((travelerY.value - SPIKE_LEVEL.fabricBounds.y) /
        SPIKE_LEVEL.fabricBounds.height) *
      size.height,
  );
  const inset = 7;

  return (
    <Canvas
      style={{ width: size.width, height: size.height }}
      accessibilityLabel="Quilt playfield. Drag across the fabric to place a stitch."
    >
      <FabricTexture
        width={size.width}
        height={size.height}
        highContrast={highContrast}
      />

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
