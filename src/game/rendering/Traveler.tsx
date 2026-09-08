import { ORIGINAL, partById, type ButtonAppearance } from '../../cosmetics/catalog';
import { Circle, Group, Line, Path } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { getGamePalette } from '../../theme/gamePalette';

interface TravelerProps {
  readonly appearance?: ButtonAppearance;
  readonly x: SharedValue<number>;
  readonly y: SharedValue<number>;
  readonly speed: SharedValue<number>;
  readonly radius: number;
  readonly highContrast?: boolean;
}

export function Traveler({
  appearance = ORIGINAL,
  x,
  y,
  speed,
  radius,
  highContrast = false,
}: TravelerProps) {
  const palette = getGamePalette(highContrast);
  const transform = useDerivedValue(() => [
    { translateX: x.value },
    { translateY: y.value },
    { rotate: Math.min(0.13, speed.value * 0.18) },
  ]);
  const face = partById(appearance.color)?.value || palette.travelerInner;
  const rim = partById(appearance.rim)?.value || palette.travelerOuter;
  const ink = appearance.color === 'color-midnight' ? '#f7ecd1' : '#243e35';
  const holeOffset = radius * 0.25;
  const holeRadius = Math.max(2.2, radius * 0.1);

  return (
    <Group transform={transform}>
      <Circle
        cx={2}
        cy={5}
        r={radius * 1.08}
        color="rgba(42,31,25,0.32)"
      />
      <Circle cx={0} cy={0} r={radius} color={rim} />
      <Circle
        cx={0}
        cy={0}
        r={radius * 0.79}
        color={face}
      />
      <Circle
        cx={-radius * 0.2}
        cy={-radius * 0.25}
        r={radius * 0.16}
        color="rgba(225,247,237,0.56)"
      />
      <Circle cx={0} cy={0} r={radius - 1} style="stroke" strokeWidth={highContrast ? 2 : 0.8} color={highContrast ? '#172a24' : rim} />
      {appearance.rim === 'rim-scalloped' && Array.from({ length: 16 }, (_, i) => {
        const angle = i * Math.PI / 8;
        return <Circle key={i} cx={Math.cos(angle) * radius * 0.88} cy={Math.sin(angle) * radius * 0.88} r={radius * 0.07} color={face} />;
      })}
      {appearance.pattern !== ORIGINAL.pattern && [-1, 1].flatMap(side => [-1, 1].map(row => {
        const cx = side * radius * 0.49; const cy = row * radius * 0.49; const d = radius * 0.09;
        return <Group key={`${side}:${row}`}>
          {appearance.pattern === 'pattern-cross-stitch' ? <>
            <Line p1={{ x: cx - d, y: cy - d }} p2={{ x: cx + d, y: cy + d }} color={ink} strokeWidth={Math.max(1, radius * 0.025)} />
            <Line p1={{ x: cx - d, y: cy + d }} p2={{ x: cx + d, y: cy - d }} color={ink} strokeWidth={Math.max(1, radius * 0.025)} />
          </> : appearance.pattern === 'pattern-daisies' ? <>
            {[0, 1, 2, 3, 4].map(i => <Circle key={i} cx={cx + Math.cos(i * Math.PI * 0.4) * d} cy={cy + Math.sin(i * Math.PI * 0.4) * d} r={d * 0.65} color="#fff4da" />)}
            <Circle cx={cx} cy={cy} r={d * 0.5} color="#956226" />
          </> : <Path path={Array.from({ length: 10 }, (_, i) => { const angle = i * Math.PI / 5 - Math.PI / 2; const r = d * (i % 2 ? 0.48 : 1.6); return `${i ? 'L' : 'M'} ${cx + Math.cos(angle) * r} ${cy + Math.sin(angle) * r}`; }).join(' ') + ' Z'} color={ink} />}
        </Group>;
      }))}
      {[-1, 1].flatMap((column) =>
        [-1, 1].map((row) => (
          <Circle
            key={`${column}-${row}`}
            cx={column * holeOffset}
            cy={row * holeOffset}
            r={holeRadius}
            color={appearance.color === 'color-midnight' ? '#f5e9ce' : palette.travelerHole}
          />
        )),
      )}
    </Group>
  );
}
