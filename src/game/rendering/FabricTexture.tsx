import { Path, Rect, Skia } from '@shopify/react-native-skia';
import { useMemo } from 'react';

interface FabricTextureProps {
  readonly width: number;
  readonly height: number;
}

function createWeavePath(
  width: number,
  height: number,
  spacing: number,
  horizontal: boolean,
) {
  const path = Skia.PathBuilder.Make();
  const extent = horizontal ? height : width;

  for (let value = spacing; value < extent; value += spacing) {
    if (horizontal) {
      path.moveTo(0, value);
      path.lineTo(width, value);
    } else {
      path.moveTo(value, 0);
      path.lineTo(value, height);
    }
  }

  return path.detach();
}

export function FabricTexture({ width, height }: FabricTextureProps) {
  const horizontalWeave = useMemo(
    () => createWeavePath(width, height, 4, true),
    [height, width],
  );
  const verticalWeave = useMemo(
    () => createWeavePath(width, height, 5, false),
    [height, width],
  );

  return (
    <>
      <Rect x={0} y={0} width={width} height={height} color="#eddfc4" />
      <Path
        path={horizontalWeave}
        style="stroke"
        strokeWidth={1}
        color="rgba(255,255,255,0.24)"
      />
      <Path
        path={verticalWeave}
        style="stroke"
        strokeWidth={1}
        color="rgba(62,50,38,0.08)"
      />
    </>
  );
}
