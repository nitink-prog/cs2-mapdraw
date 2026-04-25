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
const SIDE_BRUSH_COLORS = {
  t: '#FDAC1A',
  ct: '#1c3bec',
} as const
const BRUSH_SIZE = 7

type BrushColor = (typeof SIDE_BRUSH_COLORS)[keyof typeof SIDE_BRUSH_COLORS]

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
  const brushCursorRef = useRef<HTMLDivElement>(null)
  const activeBrushColorRef = useRef<BrushColor>(SIDE_BRUSH_COLORS.t)
  const [brushCursorColor, setBrushCursorColor] = useState<BrushColor>(
    SIDE_BRUSH_COLORS.t,
  )

  const stageStyle = useMemo(
    () => ({
      width: `${stageSize.width}px`,
      height: `${stageSize.height}px`,
    }),
    [stageSize.height, stageSize.width],
  )

  const brushCursorStyle = useMemo(() => {
    const brushCursorSize = `${BRUSH_SIZE * stageSize.scale}px`

    return {
      width: brushCursorSize,
      height: brushCursorSize,
      backgroundColor: brushCursorColor,
    }
  }, [brushCursorColor, stageSize.scale])

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

  const updateBrushCursor = useCallback(
    (
      event: KonvaEventObject<PointerEvent>,
      brushColor = activeBrushColorRef.current,
    ) => {
      const stage = event.target.getStage()
      const pointer = stage?.getPointerPosition()
      const brushCursor = brushCursorRef.current

      if (!pointer || !brushCursor) {
        return
      }

      // @ink:konva Keep the custom cursor on the DOM layer and update it by ref so pointermove drawing stays off React state.
      brushCursor.style.opacity = '1'
      brushCursor.style.backgroundColor = brushColor
      brushCursor.style.transform = `translate(${pointer.x}px, ${pointer.y}px) translate(-50%, -50%)`
    },
    [],
  )

  const hideBrushCursor = useCallback(() => {
    if (!brushCursorRef.current) {
      return
    }

    brushCursorRef.current.style.opacity = '0'
  }, [])

  const getBrushColorForPointerEvent = (
    event: KonvaEventObject<PointerEvent>,
  ): BrushColor | null => {
    if (event.evt.pointerType !== 'mouse') {
      return SIDE_BRUSH_COLORS.t
    }

    if (event.evt.button === 0) {
      return SIDE_BRUSH_COLORS.t
    }

    if (event.evt.button === 2) {
      return SIDE_BRUSH_COLORS.ct
    }

    return null
  }

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    const brushColor = getBrushColorForPointerEvent(event)

    if (!brushColor) {
      return
    }

    activeBrushColorRef.current = brushColor
    setBrushCursorColor(brushColor)
    updateBrushCursor(event, brushColor)
    event.evt.preventDefault()

    const point = getLogicalPointerPosition(event)
    const drawingLayer = drawingLayerRef.current

    if (!point || !drawingLayer) {
      return
    }

    isDrawingRef.current = true

    const line = new Konva.Line({
      points: [point.x, point.y, point.x, point.y],
      stroke: brushColor,
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
    updateBrushCursor(event)

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
        <div
          className="map-stage"
          style={stageStyle}
          onContextMenu={(event) => event.preventDefault()}
        >
          <Stage
            width={stageSize.width}
            height={stageSize.height}
            scaleX={stageSize.scale}
            scaleY={stageSize.scale}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerEnter={updateBrushCursor}
            onPointerLeave={hideBrushCursor}
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
          <div
            ref={brushCursorRef}
            className="brush-cursor"
            style={brushCursorStyle}
            aria-hidden="true"
          />
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
        <div className="mouse-legend" aria-label="Mouse button drawing colors">
          <span
            className="mouse-legend-color mouse-legend-color-t"
            aria-label="Left click draws T-side orange"
          />
          <svg
            className="mouse-legend-icon"
            viewBox="0 0 64 96"
            role="img"
            aria-label="Mouse button guide"
          >
            <path
              className="mouse-legend-shell"
              d="M32 4C17.64 4 6 15.64 6 30v36c0 14.36 11.64 26 26 26s26-11.64 26-26V30C58 15.64 46.36 4 32 4Z"
            />
            <path
              className="mouse-legend-button mouse-legend-button-left"
              d="M32 4C17.64 4 6 15.64 6 30v8h26V4Z"
            />
            <path
              className="mouse-legend-button mouse-legend-button-right"
              d="M32 4v34h26v-8C58 15.64 46.36 4 32 4Z"
            />
            <path className="mouse-legend-divider" d="M32 4v34" />
            <rect
              className="mouse-legend-wheel"
              x="28"
              y="16"
              width="8"
              height="18"
              rx="4"
            />
          </svg>
          <span
            className="mouse-legend-color mouse-legend-color-ct"
            aria-label="Right click draws CT-side blue"
          />
        </div>
        <p className="panel-copy">
          Left-drag draws T-side orange. Right-drag draws CT-side blue.
        </p>
      </aside>
    </main>
  )
}

export default App
