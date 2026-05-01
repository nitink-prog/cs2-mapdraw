import { useMemo } from 'react'
import { Circle, Group, Image } from 'react-konva'
import {
  GRENADE_EFFECTS,
  getFlashbangFullBlindLogicalRadius,
} from './grenadeEffects'
import {
  createFlashExposureCanvas,
  type FlashExposurePoint,
} from './flashExposure'

type FlashExposureOverlayProps = {
  mapImage: HTMLImageElement
  mapResolution: number
  mapWorldSize: number
  origin: FlashExposurePoint
  radius: number
}

export function FlashExposureOverlay({
  mapImage,
  mapResolution,
  mapWorldSize,
  origin,
  radius,
}: FlashExposureOverlayProps) {
  const effect = GRENADE_EFFECTS.flash
  const fullBlindRadius = getFlashbangFullBlindLogicalRadius(mapResolution)
  const { x: originX, y: originY } = origin
  const exposure = useMemo(
    () =>
      createFlashExposureCanvas({
        mapImage,
        mapWorldSize,
        origin: { x: originX, y: originY },
        radius,
      }),
    [mapImage, mapWorldSize, originX, originY, radius],
  )

  return (
    <Group listening={false}>
      <Image
        image={exposure.canvas}
        x={exposure.x - originX}
        y={exposure.y - originY}
        width={exposure.width}
        height={exposure.height}
      />
      <Circle
        radius={fullBlindRadius}
        stroke="rgba(255, 255, 255, 0.42)"
        strokeWidth={2}
        dash={[14, 10]}
        opacity={0.86}
      />
      <Circle
        radius={radius}
        stroke={effect.stroke}
        strokeWidth={2}
        dash={[4, 12]}
        opacity={0.82}
      />
    </Group>
  )
}
