import {
  BlurMask,
  Circle,
  Group,
  Line,
  vec,
} from '@shopify/react-native-skia';

import type { Point } from '../core/types';

interface CanvasStitch {
  readonly id: string;
  readonly start: Point;
  readonly end: Point;
  readonly radius: number;
  readonly preview?: boolean;
}

interface StitchRendererProps {
  readonly stitches: readonly CanvasStitch[];
}

export function StitchRenderer({ stitches }: StitchRendererProps) {
  return (
    <Group>
      {stitches.map((stitch) => {
        const dx = stitch.end.x - stitch.start.x;
        const dy = stitch.end.y - stitch.start.y;
        const length = Math.max(1, Math.hypot(dx, dy));
        const normalX = -dy / length;
        const normalY = dx / length;
        const ridgeWidth = Math.max(28, stitch.radius * 1.45);
        const color = stitch.preview ? '#d45e56' : '#a93238';

        return (
          <Group key={stitch.id} opacity={stitch.preview ? 0.74 : 1}>
            <Line
              p1={vec(
                stitch.start.x + normalX * 7,
                stitch.start.y + normalY * 7,
              )}
              p2={vec(
                stitch.end.x + normalX * 7,
                stitch.end.y + normalY * 7,
              )}
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
              p2={vec(
                stitch.end.x - normalX * 5,
                stitch.end.y - normalY * 5,
              )}
              color="rgba(255,250,232,0.52)"
              strokeWidth={ridgeWidth * 0.7}
              strokeCap="round"
            >
              <BlurMask blur={10} style="normal" respectCTM={false} />
            </Line>
            <Line
              p1={vec(stitch.start.x + 1, stitch.start.y + 3)}
              p2={vec(stitch.end.x + 1, stitch.end.y + 3)}
              color="rgba(63,24,26,0.55)"
              strokeWidth={8}
              strokeCap="round"
            />
            <Line
              p1={vec(stitch.start.x, stitch.start.y)}
              p2={vec(stitch.end.x, stitch.end.y)}
              color={color}
              strokeWidth={5}
              strokeCap="round"
            />
            <Line
              p1={vec(stitch.start.x - 1, stitch.start.y - 1)}
              p2={vec(stitch.end.x - 1, stitch.end.y - 1)}
              color="rgba(255,209,176,0.58)"
              strokeWidth={1.5}
              strokeCap="round"
            />
            {[stitch.start, stitch.end].map((endpoint, index) => (
              <Group key={index}>
                <Circle
                  cx={endpoint.x}
                  cy={endpoint.y + 2}
                  r={10}
                  color="rgba(61,31,25,0.32)"
                />
                <Circle
                  cx={endpoint.x}
                  cy={endpoint.y}
                  r={8}
                  color={color}
                />
                <Circle
                  cx={endpoint.x - 2}
                  cy={endpoint.y - 2}
                  r={2}
                  color="#f6caa3"
                />
              </Group>
            ))}
          </Group>
        );
      })}
    </Group>
  );
}
