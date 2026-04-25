import JSON5 from 'json5'
import { useEffect, useState } from 'react'

export type MapMetadata = {
  resolution: number
}

type MapMetadataLoadState =
  | {
      metadata: MapMetadata
      src: string
      status: 'ready'
    }
  | {
      metadata: null
      src: string
      status: 'error' | 'loading'
    }

const metadataCache = new Map<string, Promise<MapMetadata>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMapMetadata(value: unknown, src: string): MapMetadata {
  if (!isRecord(value) || typeof value.resolution !== 'number') {
    throw new Error(`Map metadata at ${src} is missing numeric resolution.`)
  }

  return {
    resolution: value.resolution,
  }
}

function loadMapMetadata(src: string) {
  const cachedMetadata = metadataCache.get(src)

  if (cachedMetadata) {
    return cachedMetadata
  }

  const metadataPromise = fetch(src)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load map metadata from ${src}.`)
      }

      return response.text()
    })
    .then((metadataText) => parseMapMetadata(JSON5.parse(metadataText), src))

  metadataCache.set(src, metadataPromise)

  return metadataPromise
}

export function useMapMetadata(src: string): MapMetadataLoadState {
  const [metadataState, setMetadataState] = useState<MapMetadataLoadState>({
    metadata: null,
    src,
    status: 'loading',
  })

  useEffect(() => {
    let isCurrentRequest = true

    loadMapMetadata(src)
      .then((metadata) => {
        if (isCurrentRequest) {
          setMetadataState({ metadata, src, status: 'ready' })
        }
      })
      .catch(() => {
        if (isCurrentRequest) {
          setMetadataState({ metadata: null, src, status: 'error' })
        }
      })

    return () => {
      isCurrentRequest = false
    }
  }, [src])

  return metadataState.src === src
    ? metadataState
    : { metadata: null, src, status: 'loading' }
}
