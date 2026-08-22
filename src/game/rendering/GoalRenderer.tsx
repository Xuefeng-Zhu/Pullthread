import {
  Circle,
  DashPathEffect,
  Group,
} from '@shopify/react-native-skia';

import type { Point } from '../core/types';

interface GoalRendererProps {
  readonly center: Point;
  readonly radius: number;
  readonly highlighted: boolean;
}

export function GoalRenderer({
  center,
  radius,
  highlighted,
}: GoalRendererProps) {
  const petals = Array.from({ length: 12 }, (_, index) => {
    const angle = (index / 12) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius * 1.28,
      y: center.y + Math.sin(angle) * radius * 1.28,
    };
  });

  return (
    <Group>
      {petals.map((petal, index) => (
        <Circle
          key={index}
          cx={petal.x}
          cy={petal.y}
          r={Math.max(2, radius * 0.12)}
          color={index % 2 === 0 ? '#b98a2f' : '#315d5f'}
        />
      ))}
      <Circle
        cx={center.x}
        cy={center.y + 3}
        r={radius * 1.05}
        color="rgba(58,39,23,0.25)"
      />
      <Circle
        cx={center.x}
        cy={center.y}
        r={radius}
        color={highlighted ? '#e5bd53' : '#c89a35'}
      />
      <Circle
        cx={center.x}
        cy={center.y}
        r={radius * 0.78}
        color="#edcf7b"
        style="stroke"
        strokeWidth={Math.max(3, radius * 0.12)}
      >
        <DashPathEffect intervals={[3, 4]} />
      </Circle>
      <Circle
        cx={center.x}
        cy={center.y}
        r={radius * 0.42}
        color="#8b6828"
      />
      <Circle
        cx={center.x - radius * 0.12}
        cy={center.y - radius * 0.15}
        r={radius * 0.1}
        color="rgba(255,244,190,0.62)"
      />
    </Group>
  );
}
