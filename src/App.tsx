import Konva from 'konva'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { Circle, Group, Image, Layer, Line, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  GRENADE_EFFECTS,
  getGrenadeLogicalRadius,
  type GrenadeType,
} from './grenadeEffects'
import {
  DEFAULT_MAP_ID,
  GAME_MAPS,
  getGameMapById,
  getPublicAssetUrl,
} from './mapCatalog'
import type { MapId } from './mapCatalog'
import { useMapMetadata } from './mapMetadata'
import './App.css'

const MAP_WORLD_SIZE = 1024
const SIDE_BRUSH_COLORS = {
  t: '#FDAC1A',
  ct: '#1c3bec',
} as const
const BRUSH_SIZE = 3
const BRUSH_CURSOR_SIZE = 7

type BrushColor = (typeof SIDE_BRUSH_COLORS)[keyof typeof SIDE_BRUSH_COLORS]
type ToolMode = 'ink' | GrenadeType

type InkStrokeAnnotation = {
  color: BrushColor
  id: string
  kind: 'stroke'
  points: number[]
}

type GrenadeAnnotation = {
  grenadeType: GrenadeType
  id: string
  kind: 'grenade'
  x: number
  y: number
}

type Annotation = InkStrokeAnnotation | GrenadeAnnotation

type RemovedAnnotation = {
  annotation: Annotation
  index: number
}

type HistoryAction =
  | {
      annotation: Annotation
      kind: 'add'
    }
  | {
      kind: 'remove'
      removedAnnotations: RemovedAnnotation[]
    }

type AnnotationHistory = {
  annotations: Annotation[]
  redoStack: HistoryAction[]
  undoStack: HistoryAction[]
}

const UTILITY_TOOL_OPTIONS: {
  id: GrenadeType
  iconSrc: string
  label: string
  shortcut: string
}[] = [
  {
    id: 'smoke',
    iconSrc: getPublicAssetUrl('/icons/utils/smokegrenade.svg'),
    label: GRENADE_EFFECTS.smoke.label,
    shortcut: 'A',
  },
  {
    id: 'flash',
    iconSrc: getPublicAssetUrl('/icons/utils/flashbang.svg'),
    label: GRENADE_EFFECTS.flash.label,
    shortcut: 'S',
  },
  {
    id: 'molotov',
    iconSrc: getPublicAssetUrl('/icons/utils/molotov.svg'),
    label: GRENADE_EFFECTS.molotov.label,
    shortcut: 'D',
  },
]

const TOOL_SHORTCUTS: Record<string, ToolMode> = {
  a: 'smoke',
  d: 'molotov',
  s: 'flash',
  w: 'ink',
}

function createEmptyAnnotationHistory(): AnnotationHistory {
  return {
    annotations: [],
    redoStack: [],
    undoStack: [],
  }
}

function getAnnotationHistory(
  histories: Partial<Record<MapId, AnnotationHistory>>,
  mapId: MapId,
) {
  return histories[mapId] ?? createEmptyAnnotationHistory()
}

function isEditableKeyboardTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

function applyHistoryAction(annotations: Annotation[], action: HistoryAction) {
  if (action.kind === 'add') {
    return [...annotations, action.annotation]
  }

  const removedIds = new Set(
    action.removedAnnotations.map(({ annotation }) => annotation.id),
  )

  return annotations.filter((annotation) => !removedIds.has(annotation.id))
}

function revertHistoryAction(annotations: Annotation[], action: HistoryAction) {
  if (action.kind === 'add') {
    return annotations.filter(
      (annotation) => annotation.id !== action.annotation.id,
    )
  }

  const nextAnnotations = [...annotations]

  for (const removedAnnotation of [...action.removedAnnotations].sort(
    (left, right) => left.index - right.index,
  )) {
    nextAnnotations.splice(
      removedAnnotation.index,
      0,
      removedAnnotation.annotation,
    )
  }

  return nextAnnotations
}

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
  const [showBuyZones, setShowBuyZones] = useState(true)
  const [selectedTool, setSelectedTool] = useState<ToolMode>('ink')
  const [annotationHistories, setAnnotationHistories] = useState<
    Partial<Record<MapId, AnnotationHistory>>
  >({})
  const selectedMap = getGameMapById(selectedMapId)
  const selectedMapHistory = getAnnotationHistory(
    annotationHistories,
    selectedMapId,
  )
  const canRedo = selectedMapHistory.redoStack.length > 0
  const canUndo = selectedMapHistory.undoStack.length > 0
  const selectedMapMetadata = useMapMetadata(selectedMap.metaSrc)
  const mapImage = useLoadedImage(selectedMap.radarSrc)
  const buyZonesOverlayImage = useLoadedImage(selectedMap.buyZonesOverlaySrc)
  const mapColumnRef = useRef<HTMLElement>(null)
  const stageSize = useStageSize(mapColumnRef)
  const drawingLayerRef = useRef<Konva.Layer>(null)
  const activeLineRef = useRef<Konva.Line | null>(null)
  const isDrawingRef = useRef(false)
  const annotationIdRef = useRef(0)
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
    const brushCursorSize = `${BRUSH_CURSOR_SIZE * stageSize.scale}px`

    return {
      width: brushCursorSize,
      height: brushCursorSize,
      backgroundColor: brushCursorColor,
    }
  }, [brushCursorColor, stageSize.scale])

  const stageClassName =
    selectedTool === 'ink' ? 'map-stage' : 'map-stage map-stage-placement'

  const getNextAnnotationId = useCallback(() => {
    annotationIdRef.current += 1

    return `annotation-${annotationIdRef.current}`
  }, [])

  const pushHistoryAction = useCallback(
    (mapId: MapId, action: HistoryAction) => {
      setAnnotationHistories((currentHistories) => {
        const currentHistory = getAnnotationHistory(currentHistories, mapId)

        return {
          ...currentHistories,
          [mapId]: {
            annotations: applyHistoryAction(
              currentHistory.annotations,
              action,
            ),
            redoStack: [],
            undoStack: [...currentHistory.undoStack, action],
          },
        }
      })
    },
    [],
  )

  const finishActiveStroke = useCallback(() => {
    const activeLine = activeLineRef.current
    const wasDrawing = isDrawingRef.current

    isDrawingRef.current = false
    activeLineRef.current = null

    if (!activeLine) {
      return
    }

    const color = activeLine.stroke() as BrushColor
    const points = [...activeLine.points()]
    activeLine.destroy()
    drawingLayerRef.current?.batchDraw()

    if (!wasDrawing || points.length < 4) {
      return
    }

    pushHistoryAction(selectedMapId, {
      annotation: {
        color,
        id: getNextAnnotationId(),
        kind: 'stroke',
        points,
      },
      kind: 'add',
    })
  }, [getNextAnnotationId, pushHistoryAction, selectedMapId])

  useEffect(() => {
    window.addEventListener('pointerup', finishActiveStroke)
    window.addEventListener('pointercancel', finishActiveStroke)

    return () => {
      window.removeEventListener('pointerup', finishActiveStroke)
      window.removeEventListener('pointercancel', finishActiveStroke)
    }
  }, [finishActiveStroke])

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
      const brushCursor = brushCursorRef.current

      if (!brushCursor) {
        return
      }

      if (selectedTool !== 'ink') {
        brushCursor.style.opacity = '0'
        return
      }

      const stage = event.target.getStage()
      const pointer = stage?.getPointerPosition()

      if (!pointer) {
        return
      }

      // @ink:konva Keep the custom cursor on the DOM layer and update it by ref so pointermove drawing stays off React state.
      brushCursor.style.opacity = '1'
      brushCursor.style.backgroundColor = brushColor
      brushCursor.style.transform = `translate(${pointer.x}px, ${pointer.y}px) translate(-50%, -50%)`
    },
    [selectedTool],
  )

  const hideBrushCursor = useCallback(() => {
    if (!brushCursorRef.current) {
      return
    }

    brushCursorRef.current.style.opacity = '0'
  }, [])

  useEffect(() => {
    if (selectedTool !== 'ink') {
      finishActiveStroke()
      hideBrushCursor()
    }
  }, [finishActiveStroke, hideBrushCursor, selectedTool])

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

  const addGrenadeMarker = (
    grenadeType: GrenadeType,
    point: { x: number; y: number },
  ) => {
    pushHistoryAction(selectedMapId, {
      annotation: {
        grenadeType,
        id: getNextAnnotationId(),
        kind: 'grenade',
        x: point.x,
        y: point.y,
      },
      kind: 'add',
    })
  }

  const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
    if (selectedTool !== 'ink') {
      if (event.evt.pointerType === 'mouse' && event.evt.button !== 0) {
        return
      }

      const point = getLogicalPointerPosition(event)

      if (!point) {
        return
      }

      event.evt.preventDefault()
      addGrenadeMarker(selectedTool, point)

      return
    }

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

  const removeCurrentMapAnnotations = (
    shouldRemoveAnnotation: (annotation: Annotation) => boolean,
  ) => {
    const removedAnnotations = selectedMapHistory.annotations.reduce<
      RemovedAnnotation[]
    >((removed, annotation, index) => {
      if (shouldRemoveAnnotation(annotation)) {
        removed.push({ annotation, index })
      }

      return removed
    }, [])

    if (removedAnnotations.length === 0) {
      return
    }

    pushHistoryAction(selectedMapId, {
      kind: 'remove',
      removedAnnotations,
    })
  }

  const clearDrawing = () => {
    finishActiveStroke()
    removeCurrentMapAnnotations((annotation) => annotation.kind === 'stroke')
  }

  const clearGrenades = () => {
    removeCurrentMapAnnotations((annotation) => annotation.kind === 'grenade')
  }

  const undoCurrentMapAction = useCallback(() => {
    setAnnotationHistories((currentHistories) => {
      const currentHistory = getAnnotationHistory(
        currentHistories,
        selectedMapId,
      )
      const actionToUndo = currentHistory.undoStack.at(-1)

      if (!actionToUndo) {
        return currentHistories
      }

      return {
        ...currentHistories,
        [selectedMapId]: {
          annotations: revertHistoryAction(
            currentHistory.annotations,
            actionToUndo,
          ),
          redoStack: [...currentHistory.redoStack, actionToUndo],
          undoStack: currentHistory.undoStack.slice(0, -1),
        },
      }
    })
  }, [selectedMapId])

  const redoCurrentMapAction = useCallback(() => {
    setAnnotationHistories((currentHistories) => {
      const currentHistory = getAnnotationHistory(
        currentHistories,
        selectedMapId,
      )
      const actionToRedo = currentHistory.redoStack.at(-1)

      if (!actionToRedo) {
        return currentHistories
      }

      return {
        ...currentHistories,
        [selectedMapId]: {
          annotations: applyHistoryAction(
            currentHistory.annotations,
            actionToRedo,
          ),
          redoStack: currentHistory.redoStack.slice(0, -1),
          undoStack: [...currentHistory.undoStack, actionToRedo],
        },
      }
    })
  }, [selectedMapId])

  useEffect(() => {
    const handleHistoryKeyboardShortcut = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) {
        return
      }

      const shortcutKey = event.key.toLowerCase()

      if (event.metaKey || event.ctrlKey) {
        if (shortcutKey !== 'z') {
          return
        }

        event.preventDefault()

        if (event.shiftKey) {
          redoCurrentMapAction()
          return
        }

        undoCurrentMapAction()
        return
      }

      if (event.altKey) {
        return
      }

      const nextTool = TOOL_SHORTCUTS[shortcutKey]

      if (!nextTool) {
        return
      }

      event.preventDefault()
      setSelectedTool(nextTool)
    }

    window.addEventListener('keydown', handleHistoryKeyboardShortcut)

    return () => {
      window.removeEventListener('keydown', handleHistoryKeyboardShortcut)
    }
  }, [redoCurrentMapAction, undoCurrentMapAction])

  const handleUtilityToolSelect = (utilityType: GrenadeType) => {
    setSelectedTool((currentTool) =>
      currentTool === utilityType ? 'ink' : utilityType,
    )
  }

  const handleMapSelect = (mapId: MapId) => {
    if (mapId === selectedMapId) {
      return
    }

    finishActiveStroke()
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

        <section className="map-overlay-panel" aria-label="Map overlays">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={showBuyZones}
              onChange={(event) => setShowBuyZones(event.target.checked)}
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-label">Show buy zone</span>
          </label>
        </section>
      </aside>

      <section
        ref={mapColumnRef}
        className="map-workspace"
        aria-label="Drawable CS2 map"
      >
        <div
          className={stageClassName}
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
            onPointerUp={finishActiveStroke}
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
            {/* @ink:konva React-Konva z-order follows render order; active ink must stay above committed annotations to avoid stroke pop on mouseup. */}
            <Layer listening={false}>
              {showBuyZones && buyZonesOverlayImage ? (
                <Image
                  image={buyZonesOverlayImage}
                  width={MAP_WORLD_SIZE}
                  height={MAP_WORLD_SIZE}
                />
              ) : null}
            </Layer>
            <Layer listening={false}>
              {selectedMapHistory.annotations.map((annotation) => {
                if (annotation.kind === 'stroke') {
                  return (
                    <Line
                      key={annotation.id}
                      points={annotation.points}
                      stroke={annotation.color}
                      strokeWidth={BRUSH_SIZE}
                      lineCap="round"
                      lineJoin="round"
                      tension={0.35}
                    />
                  )
                }

                const effect = GRENADE_EFFECTS[annotation.grenadeType]
                const radius =
                  selectedMapMetadata.status === 'ready'
                    ? getGrenadeLogicalRadius(
                        annotation.grenadeType,
                        selectedMapMetadata.metadata.resolution,
                      )
                    : null

                return (
                  <Group key={annotation.id} x={annotation.x} y={annotation.y}>
                    {radius !== null ? (
                      <Circle
                        radius={radius}
                        fill={effect.fill}
                        stroke={effect.stroke}
                        strokeWidth={3}
                        dash={
                          annotation.grenadeType === 'flash'
                            ? [18, 10]
                            : undefined
                        }
                      />
                    ) : null}
                    <Circle
                      radius={13}
                      fill={effect.stroke}
                      stroke="#0f172a"
                      strokeWidth={3}
                    />
                    <Text
                      x={-8}
                      y={-8}
                      width={16}
                      height={16}
                      align="center"
                      verticalAlign="middle"
                      fill="#0f172a"
                      fontSize={13}
                      fontStyle="bold"
                      text={effect.symbol}
                    />
                  </Group>
                )
              })}
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
          <h2>Tools</h2>
        </header>

        <section className="tool-group" aria-label="Annotation tools">
          <p className="panel-copy">
            Smoke radius is {GRENADE_EFFECTS.smoke.radiusGameUnits}u. Flash is
            a {GRENADE_EFFECTS.flash.radiusGameUnits}u reference radius; real
            flashes also depend on line of sight and view angle. Molotov max
            spread is {GRENADE_EFFECTS.molotov.radiusGameUnits}u.
          </p>
          {selectedMapMetadata.status === 'loading' ? (
            <p className="panel-copy">Loading map scale...</p>
          ) : null}
          {selectedMapMetadata.status === 'error' ? (
            <p className="panel-copy metadata-warning">
              Map metadata failed to load; grenade radii are hidden.
            </p>
          ) : null}
        </section>

        <div className="clear-actions">
          <button type="button" onClick={clearDrawing}>
            Clear ink
          </button>
          <button type="button" onClick={clearGrenades}>
            Clear grenades
          </button>
        </div>
        <div className="history-actions" aria-label="Map history controls">
          <button
            type="button"
            onClick={undoCurrentMapAction}
            disabled={!canUndo}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redoCurrentMapAction}
            disabled={!canRedo}
          >
            Redo
          </button>
        </div>
        <section className="tool-picker-section" aria-label="Drawing tools">
          <button
            type="button"
            className="mouse-legend ink-tool-button"
            aria-label="Use ink tool. Left-drag draws T-side orange. Right-drag draws CT-side blue."
            aria-pressed={selectedTool === 'ink'}
            onClick={() => setSelectedTool('ink')}
          >
            <span className="ink-tool-label">
              Ink <kbd className="tool-shortcut-hint">W</kbd>
            </span>
            <span
              className="mouse-legend-color mouse-legend-color-t"
              aria-hidden="true"
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
              aria-hidden="true"
            />
          </button>
          <div className="utility-tool-grid">
            {UTILITY_TOOL_OPTIONS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                className="utility-tool-button"
                aria-pressed={selectedTool === tool.id}
                onClick={() => handleUtilityToolSelect(tool.id)}
              >
                <img src={tool.iconSrc} alt="" className="utility-tool-icon" />
                <span className="utility-tool-label">
                  {tool.label}
                  <kbd className="tool-shortcut-hint">{tool.shortcut}</kbd>
                </span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </main>
  )
}

export default App
