import Konva from 'konva'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Image, Layer, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { DEFAULT_MAP_ID, GAME_MAPS, getGameMapById } from './mapCatalog'
import type { MapId } from './mapCatalog'
import './App.css'

const MAP_WORLD_SIZE = 1024
const BRUSH_COLOR = '#ff3b30'
const BRUSH_SIZE = 7

type StageSize = {
  width: number
  height: number
  scale: number
}

function getStageSize(containerWidth?: number): StageSize {
  const availableWidth = (containerWidth ?? window.innerWidth) - 32
  const availableHeight = window.innerHeight - 48
  const displaySize = Math.max(
    280,
    Math.min(MAP_WORLD_SIZE, availableWidth, availableHeight),
  )

  return {
    width: displaySize,
    height: displaySize,
    scale: displaySize / MAP_WORLD_SIZE,
  }
}

function useStageSize(containerRef: RefObject<HTMLElement | null>) {
  const [stageSize, setStageSize] = useState<StageSize>(() => getStageSize())

  useEffect(() => {
    const updateStageSize = () => {
      setStageSize(getStageSize(containerRef.current?.clientWidth))
    }

    const resizeObserver = new ResizeObserver(updateStageSize)

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    window.addEventListener('resize', updateStageSize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateStageSize)
    }
  }, [containerRef])

  return stageSize
}

function useLoadedImage(src: string) {
  const [loadedImage, setLoadedImage] = useState<{
    image: HTMLImageElement | null
    src: string
  } | null>(null)

  useEffect(() => {
    const nextImage = new window.Image()
    nextImage.onload = () => setLoadedImage({ image: nextImage, src })
    nextImage.onerror = () => setLoadedImage({ image: null, src })
    nextImage.src = src

    return () => {
      nextImage.onload = null
      nextImage.onerror = null
    }
  }, [src])

  return loadedImage?.src === src ? loadedImage.image : null
}

function App() {
  const [selectedMapId, setSelectedMapId] = useState<MapId>(DEFAULT_MAP_ID)
  const selectedMap = getGameMapById(selectedMapId)
  const mapImage = useLoadedImage(selectedMap.radarSrc)
  const mapColumnRef = useRef<HTMLElement>(null)
  const stageSize = useStageSize(mapColumnRef)
  const drawingLayerRef = useRef<Konva.Layer>(null)
  const activeLineRef = useRef<Konva.Line | null>(null)
  const isDrawingRef = useRef(false)

  const stageStyle = useMemo(
    () => ({
      width: `${stageSize.width}px`,
      height: `${stageSize.height}px`,
    }),
    [stageSize.height, stageSize.width],
  )

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false
    activeLineRef.current = null
  }, [])

  useEffect(() => {
    window.addEventListener('pointerup', stopDrawing)
    window.addEventListener('pointercancel', stopDrawing)

    return () => {
      window.removeEventListener('pointerup', stopDrawing)
      window.removeEventListener('pointercancel', stopDrawing)
    }
  }, [stopDrawing])

  const getLogicalPointerPosition = (event: KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()

    if (!pointer) {
      return null
    }

    return {
      x: pointer.x / stageSize.scale,
      y: pointer.y / stageSize.scale,
    }
  }

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    if (event.evt.pointerType === 'mouse' && event.evt.button !== 0) {
      return
    }

    const point = getLogicalPointerPosition(event)
    const drawingLayer = drawingLayerRef.current

    if (!point || !drawingLayer) {
      return
    }

    isDrawingRef.current = true

    const line = new Konva.Line({
      points: [point.x, point.y, point.x, point.y],
      stroke: BRUSH_COLOR,
      strokeWidth: BRUSH_SIZE,
      lineCap: 'round',
      lineJoin: 'round',
      tension: 0.35,
    })

    // @ink:konva Keep hot-path drawing off React state; mutate the active Konva node and batchDraw the layer.
    drawingLayer.add(line)
    activeLineRef.current = line
    drawingLayer.batchDraw()
  }

  const handlePointerMove = (event: KonvaEventObject<PointerEvent>) => {
    if (!isDrawingRef.current || !activeLineRef.current) {
      return
    }

    event.evt.preventDefault()

    const point = getLogicalPointerPosition(event)

    if (!point) {
      return
    }

    const line = activeLineRef.current
    line.points(line.points().concat([point.x, point.y]))
    drawingLayerRef.current?.batchDraw()
  }

  const clearDrawing = () => {
    drawingLayerRef.current?.destroyChildren()
    drawingLayerRef.current?.batchDraw()
    stopDrawing()
  }

  const handleMapSelect = (mapId: MapId) => {
    if (mapId === selectedMapId) {
      return
    }

    clearDrawing()
    setSelectedMapId(mapId)
  }

  return (
    <main className="app-shell">
      <aside className="side-panel general-panel" aria-label="General map settings">
        <header>
          <p className="eyebrow">CS2 MapDraw MVP</p>
          <h1 aria-label={selectedMap.name}>
            <span className="map-title">{selectedMap.name}</span>
          </h1>
        </header>

        <section className="map-picker" aria-label="Choose map">
          {GAME_MAPS.map((map) => {
            const isSelected = map.id === selectedMapId

            return (
              <button
                key={map.id}
                type="button"
                className="map-picker-button"
                aria-pressed={isSelected}
                onClick={() => handleMapSelect(map.id)}
              >
                <img src={map.badgeSrc} alt="" className="map-picker-badge" />
                <span className="map-picker-name">{map.name}</span>
              </button>
            )
          })}
        </section>
      </aside>

      <section
        ref={mapColumnRef}
        className="map-workspace"
        aria-label="Drawable CS2 map"
      >
        <div className="map-stage" style={stageStyle}>
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={stageSize.scale}
            scaleY={stageSize.scale}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDrawing}
          >
            <Layer listening={false}>
              {mapImage ? (
                <Image
                  image={mapImage}
                  width={MAP_WORLD_SIZE}
                  height={MAP_WORLD_SIZE}
                />
              ) : (
                <Text
                  x={0}
                  y={MAP_WORLD_SIZE / 2 - 18}
                  width={MAP_WORLD_SIZE}
                  align="center"
                  fill="#f3f6f9"
                  fontSize={36}
                  text={`Loading ${selectedMap.name}...`}
                />
              )}
            </Layer>
            <Layer ref={drawingLayerRef} />
          </Stage>
        </div>
      </section>

      <aside className="side-panel tools-panel" aria-label="Inking and tools">
        <header>
          <p className="eyebrow">Inking</p>
          <h2>Tools</h2>
        </header>

        <button type="button" onClick={clearDrawing}>
          Clear ink
        </button>
        <p className="panel-copy">Hold the left mouse button and drag to draw.</p>
      </aside>
    </main>
  )
}

export default App
