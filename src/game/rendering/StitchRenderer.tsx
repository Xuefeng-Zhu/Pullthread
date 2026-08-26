import {
  BlurMask,
  Circle,
  Group,
  Line,
  vec,
} from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import {
  getGamePalette,
  type GamePalette,
} from '../../theme/gamePalette';
import type { Point, StitchType } from '../core/types';

interface CanvasStitch {
  readonly id: string;
  readonly type: StitchType;
  readonly start: Point;
  readonly end: Point;
  readonly radius: number;
  readonly preview?: boolean;
}

interface StitchRendererProps {
  readonly stitches: readonly CanvasStitch[];
  readonly highContrast?: boolean;
  readonly progress: SharedValue<number>;
}

interface StitchVisualProps {
  readonly stitch: CanvasStitch;
  readonly palette: GamePalette;
  readonly progress: SharedValue<number>;
}

function StitchVisual({ stitch, palette, progress }: StitchVisualProps) {
  const dx = stitch.end.x - stitch.start.x;
  const dy = stitch.end.y - stitch.start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const ridgeWidth = Math.max(28, stitch.radius * 1.45);
  const color = stitch.preview
    ? palette.stitchPreview
    : palette.stitch;
  const endX = useDerivedValue(
    () => stitch.start.x + dx * progress.value,
  );
  const endY = useDerivedValue(
    () => stitch.start.y + dy * progress.value,
  );
  const shadowEnd = useDerivedValue(() =>
    vec(endX.value + normalX * 7, endY.value + normalY * 7),
  );
  const highlightEnd = useDerivedValue(() =>
    vec(endX.value - normalX * 5, endY.value - normalY * 5),
  );
  const threadShadowEnd = useDerivedValue(() =>
    vec(endX.value + 1, endY.value + 3),
  );
  const threadEnd = useDerivedValue(() => vec(endX.value, endY.value));
  const threadGlintEnd = useDerivedValue(() =>
    vec(endX.value - 1, endY.value - 1),
  );
  const endpointShadowY = useDerivedValue(() => endY.value + 2);
  const endpointGlintX = useDerivedValue(() => endX.value - 2);
  const endpointGlintY = useDerivedValue(() => endY.value - 2);
  const pocketCenterX = (stitch.start.x + stitch.end.x) * 0.5;
  const pocketCenterY = (stitch.start.y + stitch.end.y) * 0.5;

  return (
    <Group opacity={stitch.preview ? 0.74 : 1}>
      {stitch.type === 'pocket' ? (
        <Group>
          <Circle
            cx={pocketCenterX}
            cy={pocketCenterY + 4}
            r={stitch.radius}
            color="rgba(38,52,60,0.24)"
          />
          <Circle
            cx={pocketCenterX}
            cy={pocketCenterY}
            r={stitch.radius * 0.72}
            color="rgba(89,135,151,0.20)"
          />
        </Group>
      ) : null}
      <Line
        p1={vec(
          stitch.start.x + normalX * 7,
          stitch.start.y + normalY * 7,
        )}
        p2={shadowEnd}
        color="rgba(72,42,28,0.25)"
        strokeWidth={ridgeWidth}
        strokeCap="round"
      >
        <BlurMask blur={14} style="normal" respectCTM={false} />
      </Line>
      <Line
        p1={vec(
          stitch.start.x - normalX * 5,
          stitch.start.y - normalY * 5,
        )}
        p2={highlightEnd}
        color="rgba(255,250,232,0.52)"
        strokeWidth={ridgeWidth * 0.7}
        strokeCap="round"
      >
        <BlurMask blur={10} style="normal" respectCTM={false} />
      </Line>
      <Line
        p1={vec(stitch.start.x + 1, stitch.start.y + 3)}
        p2={threadShadowEnd}
        color="rgba(63,24,26,0.55)"
        strokeWidth={8}
        strokeCap="round"
      />
      <Line
        p1={vec(stitch.start.x, stitch.start.y)}
        p2={threadEnd}
        color={color}
        strokeWidth={5}
        strokeCap="round"
      />
      <Line
        p1={vec(stitch.start.x - 1, stitch.start.y - 1)}
        p2={threadGlintEnd}
        color={palette.stitchHighlight}
        strokeWidth={1.5}
        strokeCap="round"
      />

      <Circle
        cx={stitch.start.x}
        cy={stitch.start.y + 2}
        r={10}
        color="rgba(61,31,25,0.32)"
      />
      <Circle
        cx={stitch.start.x}
        cy={stitch.start.y}
        r={8}
        color={color}
      />
      <Circle
        cx={stitch.start.x - 2}
        cy={stitch.start.y - 2}
        r={2}
        color="#f6caa3"
      />

      <Circle
        cx={endX}
        cy={endpointShadowY}
        r={10}
        color="rgba(61,31,25,0.32)"
      />
      <Circle cx={endX} cy={endY} r={8} color={color} />
      <Circle
        cx={endpointGlintX}
        cy={endpointGlintY}
        r={2}
        color="#f6caa3"
      />
    </Group>
  );
}

export function StitchRenderer({
  stitches,
  highContrast = false,
  progress,
}: StitchRendererProps) {
  const palette = getGamePalette(highContrast);

  return (
    <Group>
      {stitches.map((stitch) => (
        <StitchVisual
          key={stitch.id}
          stitch={stitch}
          palette={palette}
          progress={progress}
        />
      ))}
    </Group>
  );
}
