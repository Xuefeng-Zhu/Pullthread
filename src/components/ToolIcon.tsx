import { Canvas, Group, Path, Skia } from '@shopify/react-native-skia';
import { memo, useMemo } from 'react';

import type { ToolKind } from '../commerce/contracts';
import { TOOL_ICON_PATHS, TOOL_ICON_SIZE, TOOL_ICON_STROKE_WIDTH } from '../commerce/toolCatalog';

interface ToolIconProps {
  readonly kind: ToolKind;
  readonly size?: number;
  readonly color?: string;
}

/** Static vector artwork; its owning control supplies the accessible label. */
export const ToolIcon = memo(function ToolIcon({ kind, size = 24, color = '#244b45' }: ToolIconProps) {
  const path = useMemo(() => Skia.Path.MakeFromSVGString(TOOL_ICON_PATHS[kind])!, [kind]);
  const transform = useMemo(() => [{ scale: size / TOOL_ICON_SIZE }], [size]);
  const style = useMemo(() => ({ width: size, height: size }), [size]);
  return <Canvas style={style} accessible={false} pointerEvents="none">
    <Group transform={transform}>
      <Path path={path} color={color} style="stroke" strokeWidth={TOOL_ICON_STROKE_WIDTH}
        strokeCap="round" strokeJoin="round" />
    </Group>
  </Canvas>;
});
