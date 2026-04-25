const MAP_IDS = [
  'de_ancient',
  'de_anubis',
  'de_cache',
  'de_dust2',
  'de_inferno',
  'de_mirage',
  'de_nuke',
  'de_overpass',
  'de_train',
  'de_vertigo',
] as const

export type MapId = (typeof MAP_IDS)[number]

export type GameMap = {
  id: MapId
  name: string
  radarSrc: string
}

const SPECIAL_MAP_NAMES: Partial<Record<MapId, string>> = {
  de_dust2: 'Dust II',
}

function formatMapName(mapId: MapId) {
  const baseName = mapId.replace(/^de_/, '')

  return (
    SPECIAL_MAP_NAMES[mapId] ??
    baseName
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  )
}

export const GAME_MAPS: GameMap[] = MAP_IDS.map((id) => ({
  id,
  name: formatMapName(id),
  radarSrc: `/maps/${id}/radar.png`,
}))

export const DEFAULT_MAP_ID: MapId = 'de_dust2'

export function getGameMapById(mapId: MapId) {
  return GAME_MAPS.find((map) => map.id === mapId) ?? GAME_MAPS[0]
}
