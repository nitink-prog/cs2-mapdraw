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
    label: 'Flash',
    radiusGameUnits: 1300,
    stroke: 'rgba(250, 204, 21, 0.78)',
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

export function getGrenadeLogicalRadius(
  grenadeType: GrenadeType,
  mapResolution: number,
) {
  // @ink:contract meta.json5 resolution is game units per one pixel of the 1024 radar image; do not apply stage scale here.
  return GRENADE_EFFECTS[grenadeType].radiusGameUnits / mapResolution
}
