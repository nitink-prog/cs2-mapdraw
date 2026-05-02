import { FLASH_EXPOSURE_TUNING } from './flashExposure'

const FLASHBANG_FULL_BLIND_RADIUS_GAME_UNITS = 1300
const FLASHBANG_MAX_PARTIAL_BLIND_RADIUS_GAME_UNITS =
  FLASH_EXPOSURE_TUNING.maxFlashRadius
const FLASHBANG_FULL_BLIND_FALLOFF_STOP =
  FLASHBANG_FULL_BLIND_RADIUS_GAME_UNITS /
  FLASHBANG_MAX_PARTIAL_BLIND_RADIUS_GAME_UNITS
const FLASHBANG_FALLOFF_COLOR_STOPS: (number | string)[] = [
  0,
  'rgba(255, 255, 255, 0.34)',
  0.18,
  'rgba(254, 240, 138, 0.28)',
  FLASHBANG_FULL_BLIND_FALLOFF_STOP,
  'rgba(250, 204, 21, 0.14)',
  0.82,
  'rgba(250, 204, 21, 0.055)',
  1,
  'rgba(250, 204, 21, 0)',
]

export const GRENADE_EFFECTS = {
  smoke: {
    fill: 'rgba(203, 213, 225, 0.2)',
    label: 'Smoke',
    radiusGameUnits: 144,
    stroke: 'rgba(226, 232, 240, 0.88)',
    symbol: 'S',
  },
  flash: {
    fill: 'rgba(250, 204, 21, 0.12)',
    fullBlindRadiusGameUnits: FLASHBANG_FULL_BLIND_RADIUS_GAME_UNITS,
    label: 'Flash',
    radiusGameUnits: FLASHBANG_MAX_PARTIAL_BLIND_RADIUS_GAME_UNITS,
    radialBlurColorStops: FLASHBANG_FALLOFF_COLOR_STOPS,
    stroke: 'rgba(250, 204, 21, 0.64)',
    symbol: 'F',
  },
  molotov: {
    fill: 'rgba(249, 115, 22, 0.16)',
    label: 'Molotov',
    radiusGameUnits: 150,
    stroke: 'rgba(249, 115, 22, 0.9)',
    symbol: 'M',
  },
} as const

export type GrenadeType = keyof typeof GRENADE_EFFECTS

/** Modeling notes for the tools panel (i) affordance; keeps copy tied to radii above. */
export function getGrenadeHelpText(type: GrenadeType): string {
  // Exhaustive switch keeps copy aligned with radius fields on each grenade kind.
  switch (type) {
    case 'smoke':
      return `Smoke radius is ${GRENADE_EFFECTS.smoke.radiusGameUnits}u.`
    case 'flash':
      return `Flash uses radar-wall line of sight with a ${GRENADE_EFFECTS.flash.radiusGameUnits}u falloff radius and a ${GRENADE_EFFECTS.flash.fullBlindRadiusGameUnits}u full-blind reference; view angle is not modeled.`
    case 'molotov':
      return `Molotov max spread is ${GRENADE_EFFECTS.molotov.radiusGameUnits}u.`
  }
}

export function getGrenadeLogicalRadius(
  grenadeType: GrenadeType,
  mapResolution: number,
) {
  // @ink:contract meta.json5 resolution is game units per one pixel of the 1024 radar image; do not apply stage scale here.
  return GRENADE_EFFECTS[grenadeType].radiusGameUnits / mapResolution
}

export function getFlashbangFullBlindLogicalRadius(mapResolution: number) {
  // @ink:why Keep the full-blind ring tied to CS2-like distance falloff; radar-wall LOS occlusion is rendered separately by the flash exposure overlay.
  return GRENADE_EFFECTS.flash.fullBlindRadiusGameUnits / mapResolution
}

export function getMaxGrenadeLogicalRadius(mapResolution: number) {
  return Math.max(
    ...Object.keys(GRENADE_EFFECTS).map((grenadeType) =>
      getGrenadeLogicalRadius(grenadeType as GrenadeType, mapResolution),
    ),
  )
}
