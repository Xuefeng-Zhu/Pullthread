import { Circle, Group } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { getGamePalette } from '../../theme/gamePalette';

interface TravelerProps {
  readonly x: SharedValue<number>;
  readonly y: SharedValue<number>;
  readonly speed: SharedValue<number>;
  readonly radius: number;
  readonly highContrast?: boolean;
}

export function Traveler({
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
      <Circle cx={0} cy={0} r={radius} color={palette.travelerOuter} />
      <Circle
        cx={0}
        cy={0}
        r={radius * 0.79}
        color={palette.travelerInner}
      />
      <Circle
        cx={-radius * 0.2}
        cy={-radius * 0.25}
        r={radius * 0.16}
        color="rgba(225,247,237,0.56)"
      />
      {[-1, 1].flatMap((column) =>
        [-1, 1].map((row) => (
          <Circle
            key={`${column}-${row}`}
            cx={column * holeOffset}
            cy={row * holeOffset}
            r={holeRadius}
            color={palette.travelerHole}
          />
        )),
      )}
    </Group>
  );
}
