import Konva from 'konva'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Circle, Group, Image, Layer, Line, Stage, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  GRENADE_EFFECTS,
  getFlashbangFullBlindLogicalRadius,
  getGrenadeHelpText,
  getGrenadeLogicalRadius,
  type GrenadeType,
} from './grenadeEffects'
import { FlashExposureOverlay } from './FlashExposureOverlay'
import {
  DEFAULT_MAP_ID,
  GAME_MAPS,
  getGameMapById,
  getPublicAssetUrl,
} from './mapCatalog'
import type { MapId } from './mapCatalog'
import { useMapMetadata } from './mapMetadata'
import './App.css'

function clientUsesAppleModifierHints(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  return (
    /Mac|iPhone|iPad|iPod/i.test(platform) ||
    /\biPhone\b|\biPad\b|\biPod\b/i.test(ua)
  )
}

const MAP_WORLD_SIZE = 1024
const SIDE_BRUSH_COLORS = {
  t: '#FDAC1A',
  ct: '#1c3bec',
} as const
const BRUSH_SIZE = 3
const BRUSH_CURSOR_SIZE = 7
const OUT_OF_BOUNDS_CURSOR_COLOR = '#ef4444'
const MAX_AUTO_ZOOM = 2
const MIN_MANUAL_ZOOM = 1
const MAX_MANUAL_ZOOM = 5
const ZOOM_BUTTON_STEP = 0.25
const WHEEL_ZOOM_FACTOR = 1.08
const NAVIGATION_GESTURE_LOCK_RELEASE_MS = 180

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
      grenadeId: string
      kind: 'moveGrenade'
      next: Point
      prev: Point
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

type Point = {
  x: number
  y: number
}

type MapViewTransform = {
  scale: number
  x: number
  y: number
}

type PanGesture = {
  panStart: Point
  pointerStart: Point
}

type NavigationGestureMode = 'pan' | 'zoom'

type NavigationGestureLock = {
  mode: NavigationGestureMode
  releaseTimer: number | null
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

function GrenadeUtilityToolCell({
  tool,
  selectedTool,
  onSelect,
}: {
  tool: (typeof UTILITY_TOOL_OPTIONS)[number]
  selectedTool: ToolMode
  onSelect: (type: GrenadeType) => void
}) {
  const [helpPinned, setHelpPinned] = useState(false)
  const [hoverReveal, setHoverReveal] = useState(false)
  const [focusReveal, setFocusReveal] = useState(false)
  const cellRef = useRef<HTMLDivElement>(null)
  const helpBtnRef = useRef<HTMLButtonElement>(null)
  const tooltipPortalRef = useRef<HTMLDivElement>(null)
  const hoverDismissTimerRef = useRef<number>(null)
  const helpText = getGrenadeHelpText(tool.id)

  const tooltipOpen = helpPinned || hoverReveal || focusReveal

  const clearHoverDismissTimer = useCallback(() => {
    if (hoverDismissTimerRef.current !== null) {
      window.clearTimeout(hoverDismissTimerRef.current)
      hoverDismissTimerRef.current = null
    }
  }, [])

  const scheduleHoverDismiss = useCallback(() => {
    clearHoverDismissTimer()
    hoverDismissTimerRef.current = window.setTimeout(() => {
      setHoverReveal(false)
      hoverDismissTimerRef.current = null
    }, 140)
  }, [clearHoverDismissTimer])

  useEffect(() => {
    return () => clearHoverDismissTimer()
  }, [clearHoverDismissTimer])

  useLayoutEffect(() => {
    if (!tooltipOpen || !helpBtnRef.current || !tooltipPortalRef.current) {
      return
    }

    const tip = tooltipPortalRef.current
    const margin = 8

    const updatePosition = () => {
      const btn = helpBtnRef.current
      if (!btn || !tooltipPortalRef.current) {
        return
      }

      const rect = btn.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const width = Math.min(280, vw - margin * 2)

      tip.style.width = `${width}px`

      let left = rect.right - width
      left = Math.max(margin, Math.min(left, vw - width - margin))

      const tipHeight = tip.offsetHeight
      let top = rect.bottom + margin
      if (top + tipHeight > vh - margin) {
        top = rect.top - tipHeight - margin
      }
      if (top < margin) {
        top = margin
      }

      tip.style.left = `${left}px`
      tip.style.top = `${top}px`
    }

    updatePosition()

    const resizeObserver = new ResizeObserver(updatePosition)
    resizeObserver.observe(tip)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [tooltipOpen, helpText])

  useEffect(() => {
    if (!helpPinned) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) {
        return
      }
      if (cellRef.current?.contains(target)) {
        return
      }
      if (tooltipPortalRef.current?.contains(target)) {
        return
      }
      setHelpPinned(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [helpPinned])

  const supportsFineHover =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: hover)').matches

  return (
    <div ref={cellRef} className="utility-tool-cell">
      <button
        type="button"
        className="utility-tool-button"
        aria-pressed={selectedTool === tool.id}
        onClick={() => onSelect(tool.id)}
      >
        <img src={tool.iconSrc} alt="" className="utility-tool-icon" />
        <span className="utility-tool-label">
          {tool.label}
          <kbd className="tool-shortcut-hint">{tool.shortcut}</kbd>
        </span>
      </button>
      {/* @ink:ux Portal tooltip escapes .side-panel overflow; hover bridge keeps it open moving onto the panel; pin uses outside-dismiss excluding tooltip node. */}
      <button
        ref={helpBtnRef}
        type="button"
        className="utility-tool-help-btn"
        aria-label={`How ${tool.label} radius is modeled`}
        aria-expanded={helpPinned}
        aria-controls={`grenade-help-${tool.id}`}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseEnter={() => {
          if (!supportsFineHover || helpPinned) {
            return
          }
          clearHoverDismissTimer()
          setHoverReveal(true)
        }}
        onMouseLeave={() => {
          if (!supportsFineHover || helpPinned) {
            return
          }
          scheduleHoverDismiss()
        }}
        onFocus={(event) => {
          if (!event.currentTarget.matches(':focus-visible')) {
            return
          }
          clearHoverDismissTimer()
          setFocusReveal(true)
        }}
        onBlur={() => setFocusReveal(false)}
        onClick={(event) => {
          event.stopPropagation()
          setHelpPinned((previous) => !previous)
        }}
      >
        <span className="utility-tool-help-icon" aria-hidden>
          i
        </span>
      </button>
      {tooltipOpen
        ? createPortal(
            <div
              ref={tooltipPortalRef}
              className="grenade-help-tooltip-portal"
              role="tooltip"
              id={`grenade-help-${tool.id}`}
              onMouseEnter={() => {
                if (!supportsFineHover || helpPinned) {
                  return
                }
                clearHoverDismissTimer()
              }}
              onMouseLeave={() => {
                if (!supportsFineHover || helpPinned) {
                  return
                }
                scheduleHoverDismiss()
              }}
            >
              {helpText}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
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

function isMapPointInBounds(point: { x: number; y: number }) {
  return (
    point.x >= 0 &&
    point.x <= MAP_WORLD_SIZE &&
    point.y >= 0 &&
    point.y <= MAP_WORLD_SIZE
  )
}

function clampZoom(zoom: number, maxZoom = MAX_MANUAL_ZOOM) {
  return Math.min(maxZoom, Math.max(MIN_MANUAL_ZOOM, zoom))
}

function getMapPointFromStagePoint(
  stagePoint: Point,
  mapView: MapViewTransform,
) {
  return {
    x: (stagePoint.x - mapView.x) / mapView.scale,
    y: (stagePoint.y - mapView.y) / mapView.scale,
  }
}

function getPanForZoomAtStagePoint(
  stagePoint: Point,
  oldMapView: MapViewTransform,
  nextZoom: number,
  stageSize: StageSize,
) {
  const mapPoint = getMapPointFromStagePoint(stagePoint, oldMapView)
  const nextScale = stageSize.mapScale * nextZoom

  return {
    x: stagePoint.x - stageSize.mapX - mapPoint.x * nextScale,
    y: stagePoint.y - stageSize.mapY - mapPoint.y * nextScale,
  }
}

function applyHistoryAction(annotations: Annotation[], action: HistoryAction) {
  if (action.kind === 'add') {
    return [...annotations, action.annotation]
  }

  if (action.kind === 'moveGrenade') {
    return annotations.map((annotation) => {
      if (
        annotation.kind === 'grenade' &&
        annotation.id === action.grenadeId
      ) {
        return { ...annotation, x: action.next.x, y: action.next.y }
      }

      return annotation
    })
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

  if (action.kind === 'moveGrenade') {
    return annotations.map((annotation) => {
      if (
        annotation.kind === 'grenade' &&
        annotation.id === action.grenadeId
      ) {
        return { ...annotation, x: action.prev.x, y: action.prev.y }
      }

      return annotation
    })
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

function findAncestorNamed(target: Konva.Node | null, name: string) {
  const stage = target?.getStage() ?? null
  let node: Konva.Node | null = target

  while (node !== null && node !== stage) {
    if (node.name() === name) {
      return node
    }

    node = node.getParent()
  }

  return null
}

function pointerEventHitsNamedSubtree(
  event: KonvaEventObject<PointerEvent>,
  ancestorName: string,
) {
  if (findAncestorNamed(event.target as Konva.Node, ancestorName)) {
    return true
  }

  const stage = event.target.getStage()
  const pointer = stage?.getPointerPosition()

  if (!stage || !pointer) {
    return false
  }

  const hit = stage.getIntersection(pointer)

  return findAncestorNamed(hit, ancestorName) !== null
}

/** @ink:konva Center F/S/M handle only — skips ink strokes and skips utility placement only when tapping an existing marker handle (overlap in blast radius stays allowed). */
function isGrenadeDragHandlePointerEvent(
  event: KonvaEventObject<PointerEvent>,
) {
  return pointerEventHitsNamedSubtree(event, 'grenade-drag-handle')
}

type StageSize = {
  height: number
  mapScale: number
  mapX: number
  mapY: number
  width: number
}

type StageBounds = {
  height: number
  width: number
}

function getViewportStageBounds(): StageBounds {
  return {
    height: window.innerHeight,
    width: window.innerWidth,
  }
}

function getStageBoundsFromElement(element: HTMLElement | null): StageBounds {
  if (!element) {
    return getViewportStageBounds()
  }

  const bounds = element.getBoundingClientRect()

  if (bounds.width <= 0 || bounds.height <= 0) {
    return getViewportStageBounds()
  }

  return {
    height: bounds.height,
    width: bounds.width,
  }
}

function getStageSize(bounds: StageBounds): StageSize {
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const mapScale = Math.min(
    MAX_AUTO_ZOOM,
    width / MAP_WORLD_SIZE,
    height / MAP_WORLD_SIZE,
  )
  const displaySize = MAP_WORLD_SIZE * mapScale

  return {
    height,
    mapScale,
    mapX: (width - displaySize) / 2,
    mapY: (height - displaySize) / 2,
    width,
  }
}

function useStageSize(containerRef: { current: HTMLElement | null }) {
  const [stageSize, setStageSize] = useState<StageSize>(() =>
    getStageSize(getViewportStageBounds()),
  )

  useEffect(() => {
    const updateStageSize = () => {
      setStageSize(
        getStageSize(getStageBoundsFromElement(containerRef.current)),
      )
    }
    const container = containerRef.current

    window.addEventListener('resize', updateStageSize)
    const resizeObserver =
      container && 'ResizeObserver' in window
        ? new ResizeObserver(updateStageSize)
        : null

    if (container) {
      resizeObserver?.observe(container)
    }

    updateStageSize()

    return () => {
      window.removeEventListener('resize', updateStageSize)
      resizeObserver?.disconnect()
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

type GrenadeEffectRadiusProps = {
  grenadeType: GrenadeType
  mapImage: HTMLImageElement | null
  mapResolution: number
  origin: Point
  radius: number
  /** @ink:perf Full raycast overlay is skipped during active grenade drag; use radial fallback until pointer release. */
  useSimpleFlashWhileDragging: boolean
  useRaycastedFlashes: boolean
}

function RadialFlashbangEffectRadius({
  mapResolution,
  radius,
}: Pick<GrenadeEffectRadiusProps, 'mapResolution' | 'radius'>) {
  const effect = GRENADE_EFFECTS.flash
  const fullBlindRadius = getFlashbangFullBlindLogicalRadius(mapResolution)

  return (
    <Group listening={false}>
      <Circle
        radius={radius}
        fillRadialGradientStartPoint={{ x: 0, y: 0 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndPoint={{ x: 0, y: 0 }}
        fillRadialGradientEndRadius={radius}
        fillRadialGradientColorStops={effect.radialBlurColorStops}
        shadowColor="rgba(250, 204, 21, 0.34)"
        shadowBlur={18}
        shadowOpacity={0.72}
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

function GrenadeEffectRadius({
  grenadeType,
  mapImage,
  mapResolution,
  origin,
  radius,
  useRaycastedFlashes,
  useSimpleFlashWhileDragging,
}: GrenadeEffectRadiusProps) {
  const effect = GRENADE_EFFECTS[grenadeType]

  if (grenadeType === 'flash') {
    if (!useRaycastedFlashes || useSimpleFlashWhileDragging) {
      return (
        <RadialFlashbangEffectRadius
          mapResolution={mapResolution}
          radius={radius}
        />
      )
    }

    if (!mapImage) {
      return null
    }

    return (
      <FlashExposureOverlay
        mapImage={mapImage}
        mapResolution={mapResolution}
        mapWorldSize={MAP_WORLD_SIZE}
        origin={origin}
        radius={radius}
      />
    )
  }

  return (
    <Circle
      listening={false}
      radius={radius}
      fill={effect.fill}
      stroke={effect.stroke}
      strokeWidth={3}
    />
  )
}

function App() {
  const [selectedMapId, setSelectedMapId] = useState<MapId>(DEFAULT_MAP_ID)
  const [showBuyZones, setShowBuyZones] = useState(true)
  const [useRaycastedFlashes, setUseRaycastedFlashes] = useState(true)
  const [selectedTool, setSelectedTool] = useState<ToolMode>('ink')
  const [selectedBrushColor, setSelectedBrushColor] = useState<BrushColor>(
    SIDE_BRUSH_COLORS.t,
  )
  const [isMapPickerOpen, setIsMapPickerOpen] = useState(false)
  const [isAutoZoom, setIsAutoZoom] = useState(true)
  const [userZoom, setUserZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
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
  const mapWorkspaceRef = useRef<HTMLElement>(null)
  const stageSize = useStageSize(mapWorkspaceRef)
  const maxUserZoom = MAX_MANUAL_ZOOM / stageSize.mapScale
  const effectiveUserZoom = isAutoZoom ? 1 : clampZoom(userZoom, maxUserZoom)
  // @ink:konva Annotations stay in 0..1024 map coordinates; Auto-Zoom fits those drawable bounds to the measured workspace, capped at 200%.
  const mapView = useMemo<MapViewTransform>(
    () => ({
      scale: stageSize.mapScale * effectiveUserZoom,
      x: stageSize.mapX + (isAutoZoom ? 0 : pan.x),
      y: stageSize.mapY + (isAutoZoom ? 0 : pan.y),
    }),
    [
      effectiveUserZoom,
      isAutoZoom,
      pan.x,
      pan.y,
      stageSize.mapScale,
      stageSize.mapX,
      stageSize.mapY,
    ],
  )
  const zoomPercent = Math.round(mapView.scale * 100)
  const modifierHintsApple = useMemo(() => clientUsesAppleModifierHints(), [])
  const drawingLayerRef = useRef<Konva.Layer>(null)
  const activeLineRef = useRef<Konva.Line | null>(null)
  const isDrawingRef = useRef(false)
  const panGestureRef = useRef<PanGesture | null>(null)
  const navigationGestureLockRef = useRef<NavigationGestureLock | null>(null)
  const annotationIdRef = useRef(0)
  const brushCursorRef = useRef<HTMLDivElement>(null)
  const activeBrushColorRef = useRef<BrushColor>(SIDE_BRUSH_COLORS.t)
  const [brushCursorColor, setBrushCursorColor] = useState<BrushColor>(
    SIDE_BRUSH_COLORS.t,
  )
  const [draggingGrenadeId, setDraggingGrenadeId] = useState<string | null>(
    null,
  )
  const [draggingGrenadePosition, setDraggingGrenadePosition] =
    useState<Point | null>(null)
  const grenadeDragStartRef = useRef<{
    id: string
    x: number
    y: number
  } | null>(null)

  const setKonvaCanvasesCursor = useCallback((cursor: string) => {
    const stage = drawingLayerRef.current?.getStage()
    const canvases = stage?.container()?.querySelectorAll('canvas')

    canvases?.forEach((canvas) => {
      if (canvas instanceof HTMLElement) {
        canvas.style.cursor = cursor
      }
    })
  }, [])

  const restoreKonvaCanvasCursor = useCallback(() => {
    setKonvaCanvasesCursor(selectedTool === 'ink' ? 'none' : 'crosshair')
  }, [selectedTool, setKonvaCanvasesCursor])

  const stageStyle = useMemo(
    () => ({
      width: `${stageSize.width}px`,
      height: `${stageSize.height}px`,
    }),
    [stageSize.height, stageSize.width],
  )

  const brushCursorStyle = useMemo(() => {
    const brushCursorSize = `${BRUSH_CURSOR_SIZE * mapView.scale}px`

    return {
      width: brushCursorSize,
      height: brushCursorSize,
      backgroundColor: brushCursorColor,
    }
  }, [brushCursorColor, mapView.scale])

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

  const releaseNavigationGestureLock = useCallback(() => {
    const currentLock = navigationGestureLockRef.current
    const releaseTimer = currentLock?.releaseTimer

    if (releaseTimer !== undefined && releaseTimer !== null) {
      window.clearTimeout(releaseTimer)
    }

    navigationGestureLockRef.current = null
  }, [])

  const lockNavigationGesture = useCallback(
    (
      mode: NavigationGestureMode,
      releaseDelay: number | null = NAVIGATION_GESTURE_LOCK_RELEASE_MS,
    ) => {
      const currentLock = navigationGestureLockRef.current
      const releaseTimer = currentLock?.releaseTimer

      if (currentLock && currentLock.mode !== mode) {
        return false
      }

      if (releaseTimer !== undefined && releaseTimer !== null) {
        window.clearTimeout(releaseTimer)
      }

      navigationGestureLockRef.current = {
        mode,
        releaseTimer:
          releaseDelay === null
            ? null
            : window.setTimeout(() => {
                if (navigationGestureLockRef.current?.mode === mode) {
                  navigationGestureLockRef.current = null
                }
              }, releaseDelay),
      }

      return true
    },
    [],
  )

  const stopPanGesture = useCallback(() => {
    panGestureRef.current = null
  }, [])

  useEffect(() => {
    const handlePointerEnd = () => {
      finishActiveStroke()
      stopPanGesture()
      releaseNavigationGestureLock()
    }

    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)

    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      releaseNavigationGestureLock()
    }
  }, [finishActiveStroke, releaseNavigationGestureLock, stopPanGesture])

  const getLogicalPointerPosition = (event: KonvaEventObject<PointerEvent>) => {
    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()

    if (!pointer) {
      return null
    }

    const point = getMapPointFromStagePoint(pointer, mapView)

    return isMapPointInBounds(point) ? point : null
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

      const logicalPoint = getMapPointFromStagePoint(pointer, mapView)
      const cursorColor = isMapPointInBounds(logicalPoint)
        ? brushColor
        : OUT_OF_BOUNDS_CURSOR_COLOR

      // @ink:konva Keep the custom cursor on the DOM layer and update it by ref so pointermove drawing stays off React state.
      brushCursor.style.opacity = '1'
      brushCursor.style.backgroundColor = cursorColor
      brushCursor.style.transform = `translate(${pointer.x}px, ${pointer.y}px) translate(-50%, -50%)`
    },
    [mapView, selectedTool],
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
      return selectedBrushColor
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
    if (event.evt.pointerType === 'mouse' && event.evt.button === 1) {
      const stage = event.target.getStage()
      const pointer = stage?.getPointerPosition()

      if (!pointer) {
        return
      }

      event.evt.preventDefault()

      if (!lockNavigationGesture('pan', null)) {
        return
      }

      finishActiveStroke()
      hideBrushCursor()
      setIsAutoZoom(false)
      setUserZoom(effectiveUserZoom)
      panGestureRef.current = {
        panStart: isAutoZoom ? { x: 0, y: 0 } : pan,
        pointerStart: pointer,
      }
      return
    }

    if (selectedTool !== 'ink') {
      if (event.evt.pointerType === 'mouse' && event.evt.button !== 0) {
        return
      }

      if (isGrenadeDragHandlePointerEvent(event)) {
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

    // @ink:konva Same handle-only hit test as utility placement.
    if (isGrenadeDragHandlePointerEvent(event)) {
      return
    }

    const brushColor = getBrushColorForPointerEvent(event)

    if (!brushColor) {
      return
    }

    activeBrushColorRef.current = brushColor
    setSelectedBrushColor(brushColor)
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
    const panGesture = panGestureRef.current

    if (panGesture) {
      const stage = event.target.getStage()
      const pointer = stage?.getPointerPosition()

      if (!pointer) {
        return
      }

      event.evt.preventDefault()
      setPan({
        x: panGesture.panStart.x + pointer.x - panGesture.pointerStart.x,
        y: panGesture.panStart.y + pointer.y - panGesture.pointerStart.y,
      })
      return
    }

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

  const handlePointerUp = () => {
    finishActiveStroke()
    stopPanGesture()
    releaseNavigationGestureLock()
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

  const setManualZoomAtStagePoint = useCallback(
    (nextZoom: number, stagePoint: Point) => {
      const clampedZoom = clampZoom(nextZoom, maxUserZoom)

      setIsAutoZoom(false)
      setUserZoom(clampedZoom)
      setPan(
        getPanForZoomAtStagePoint(stagePoint, mapView, clampedZoom, stageSize),
      )
    },
    [mapView, maxUserZoom, stageSize],
  )

  const changeZoomByPercent = (delta: number) => {
    const nextScale = Math.min(
      MAX_MANUAL_ZOOM,
      Math.max(stageSize.mapScale, mapView.scale + delta),
    )
    const stageCenter = {
      x: stageSize.width / 2,
      y: stageSize.height / 2,
    }

    setManualZoomAtStagePoint(nextScale / stageSize.mapScale, stageCenter)
  }

  const handleWheel = (event: KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault()

    const stage = event.target.getStage()
    const pointer = stage?.getPointerPosition()

    if (!pointer) {
      return
    }

    const { ctrlKey, deltaX, deltaY } = event.evt
    // @ink:ux Do not classify small vertical-only wheel deltas as trackpad pan; smooth mouse wheels emit those too.
    const isTrackpadPan = !ctrlKey && Math.abs(deltaX) > 0
    const gestureMode: NavigationGestureMode = isTrackpadPan ? 'pan' : 'zoom'

    // @ink:ux Wheel gestures can emit mixed pan/zoom-looking deltas; first mode wins until the event burst settles.
    if (!lockNavigationGesture(gestureMode)) {
      return
    }

    if (isTrackpadPan) {
      finishActiveStroke()
      setIsAutoZoom(false)
      setUserZoom(effectiveUserZoom)
      setPan((currentPan) => ({
        x: (isAutoZoom ? 0 : currentPan.x) - deltaX,
        y: (isAutoZoom ? 0 : currentPan.y) - deltaY,
      }))
      return
    }

    const zoomDirection = deltaY > 0 ? 1 / WHEEL_ZOOM_FACTOR : WHEEL_ZOOM_FACTOR
    const nextZoom = effectiveUserZoom * zoomDirection

    finishActiveStroke()
    setManualZoomAtStagePoint(nextZoom, pointer)
  }

  const resetAutoZoom = () => {
    setIsAutoZoom(true)
    setUserZoom(1)
    setPan({ x: 0, y: 0 })
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

  const handleBrushColorSelect = (brushColor: BrushColor) => {
    activeBrushColorRef.current = brushColor
    setSelectedBrushColor(brushColor)
    setBrushCursorColor(brushColor)
    setSelectedTool('ink')
  }

  const handleMapSelect = (mapId: MapId) => {
    if (mapId === selectedMapId) {
      setIsMapPickerOpen(false)
      return
    }

    finishActiveStroke()
    resetAutoZoom()
    setSelectedMapId(mapId)
    setIsMapPickerOpen(false)
  }

  return (
    <main className="app-shell">
      <aside className="side-panel general-panel" aria-label="General map settings">
        <header className="general-panel-header">
          <p className="eyebrow">CS2 MapDraw</p>
          <h1 aria-label={selectedMap.name}>
            <span className="map-title desktop-map-title">{selectedMap.name}</span>
            <button
              type="button"
              className="mobile-map-picker-toggle"
              aria-expanded={isMapPickerOpen}
              aria-controls="map-picker-list"
              onClick={() =>
                setIsMapPickerOpen((currentIsOpen) => !currentIsOpen)
              }
            >
              <span className="map-title">{selectedMap.name}</span>
              <span className="map-picker-chevron" aria-hidden="true" />
            </button>
          </h1>
        </header>

        <section
          id="map-picker-list"
          className={`map-picker${isMapPickerOpen ? ' map-picker-open' : ''}`}
          aria-label="Choose map"
        >
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

        {/* @ink:ux Footer uses margin-top:auto on desktop so attribution + overlays pin below the scrollable map grid; on mobile .general-panel scrolls (see App.css). */}
        <div className="general-panel-footer">
          <section
            className="creator-attribution-card"
            aria-label="About CS2 MapDraw"
          >
            <p className="creator-attribution-heading">Created by Nitin K</p>
            <p className="creator-attribution-body">
              I created this for CS2 players looking for a smooth map drawing
              app. Other sites I tried had clunky zooming and panning,
              didn&apos;t have tool shortcuts, or didn&apos;t even take the map
              into consideration when rendering flashes. CS2 MapDraw solves
              these issues.
            </p>
            <p className="creator-attribution-body">
              I hope this free tool helps with planning and strategy.
            </p>
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
        </div>
      </aside>

      <section
        ref={mapWorkspaceRef}
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerEnter={updateBrushCursor}
            onPointerLeave={hideBrushCursor}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          >
            <Layer listening={false}>
              <Group
                x={mapView.x}
                y={mapView.y}
                scaleX={mapView.scale}
                scaleY={mapView.scale}
              >
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
              </Group>
            </Layer>
            {/* @ink:konva Stage layers use map-local groups; active ink must stay above committed annotations to avoid stroke pop on mouseup. */}
            <Layer listening={false}>
              <Group
                x={mapView.x}
                y={mapView.y}
                scaleX={mapView.scale}
                scaleY={mapView.scale}
              >
                {showBuyZones && buyZonesOverlayImage ? (
                  <Image
                    image={buyZonesOverlayImage}
                    width={MAP_WORLD_SIZE}
                    height={MAP_WORLD_SIZE}
                  />
                ) : null}
              </Group>
            </Layer>
            {/* @ink:konva Layer listening picks up draggable grenades; ink Lines use listening={false} so hits pass through stacked strokes onto markers below where possible */}
            <Layer listening>
              <Group
                x={mapView.x}
                y={mapView.y}
                scaleX={mapView.scale}
                scaleY={mapView.scale}
              >
                {selectedMapHistory.annotations.map((annotation) => {
                  if (annotation.kind === 'stroke') {
                    return (
                      <Line
                        key={annotation.id}
                        listening={false}
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
                  const mapResolution =
                    selectedMapMetadata.status === 'ready'
                      ? selectedMapMetadata.metadata.resolution
                      : null
                  const radius =
                    mapResolution !== null
                      ? getGrenadeLogicalRadius(
                          annotation.grenadeType,
                          mapResolution,
                        )
                      : null

                  const displayX =
                    draggingGrenadeId === annotation.id &&
                    draggingGrenadePosition !== null
                      ? draggingGrenadePosition.x
                      : annotation.x
                  const displayY =
                    draggingGrenadeId === annotation.id &&
                    draggingGrenadePosition !== null
                      ? draggingGrenadePosition.y
                      : annotation.y
                  const useSimpleFlashWhileDragging =
                    useRaycastedFlashes &&
                    draggingGrenadeId === annotation.id

                  return (
                    <Group
                      key={annotation.id}
                      name="grenade-annotation"
                      x={displayX}
                      y={displayY}
                    >
                      {radius !== null && mapResolution !== null ? (
                        <GrenadeEffectRadius
                          grenadeType={annotation.grenadeType}
                          mapImage={mapImage}
                          mapResolution={mapResolution}
                          origin={{ x: displayX, y: displayY }}
                          radius={radius}
                          useRaycastedFlashes={useRaycastedFlashes}
                          useSimpleFlashWhileDragging={
                            useSimpleFlashWhileDragging
                          }
                        />
                      ) : null}
                      {/* @ink:ux Draggable hit is only this group (F/S/M); AO visuals are non-interactive except via Stage routing */}
                      <Group
                        draggable
                        name="grenade-drag-handle"
                        onDragStart={(dragEvent) => {
                          dragEvent.cancelBubble = true
                          const handle = dragEvent.target as Konva.Group
                          handle.x(0)
                          handle.y(0)
                          grenadeDragStartRef.current = {
                            id: annotation.id,
                            x: annotation.x,
                            y: annotation.y,
                          }
                          setDraggingGrenadeId(annotation.id)
                          setDraggingGrenadePosition({
                            x: annotation.x,
                            y: annotation.y,
                          })
                          setKonvaCanvasesCursor('grabbing')
                        }}
                        onDragMove={(dragEvent) => {
                          const handle = dragEvent.target as Konva.Group
                          const parent = handle.getParent()
                          if (!parent) {
                            return
                          }

                          let nextX = parent.x() + handle.x()
                          let nextY = parent.y() + handle.y()
                          nextX = Math.min(
                            MAP_WORLD_SIZE,
                            Math.max(0, nextX),
                          )
                          nextY = Math.min(
                            MAP_WORLD_SIZE,
                            Math.max(0, nextY),
                          )
                          parent.x(nextX)
                          parent.y(nextY)
                          handle.x(0)
                          handle.y(0)
                          setDraggingGrenadePosition({
                            x: nextX,
                            y: nextY,
                          })
                        }}
                        onDragEnd={(dragEvent) => {
                          dragEvent.cancelBubble = true
                          const handle = dragEvent.target as Konva.Group
                          const parent = handle.getParent()
                          if (!parent) {
                            return
                          }

                          let nextX = parent.x() + handle.x()
                          let nextY = parent.y() + handle.y()
                          nextX = Math.min(
                            MAP_WORLD_SIZE,
                            Math.max(0, nextX),
                          )
                          nextY = Math.min(
                            MAP_WORLD_SIZE,
                            Math.max(0, nextY),
                          )
                          parent.x(nextX)
                          parent.y(nextY)
                          handle.x(0)
                          handle.y(0)

                          const dragStartSnapshot =
                            grenadeDragStartRef.current
                          grenadeDragStartRef.current = null
                          setDraggingGrenadeId(null)
                          setDraggingGrenadePosition(null)
                          restoreKonvaCanvasCursor()

                          if (
                            !dragStartSnapshot ||
                            dragStartSnapshot.id !== annotation.id
                          ) {
                            return
                          }

                          const moved =
                            Math.hypot(
                              nextX - dragStartSnapshot.x,
                              nextY - dragStartSnapshot.y,
                            ) >= 0.5

                          if (!moved) {
                            return
                          }

                          pushHistoryAction(selectedMapId, {
                            grenadeId: annotation.id,
                            kind: 'moveGrenade',
                            next: {
                              x: nextX,
                              y: nextY,
                            },
                            prev: {
                              x: dragStartSnapshot.x,
                              y: dragStartSnapshot.y,
                            },
                          })
                        }}
                        onMouseEnter={() => {
                          if (draggingGrenadeId !== null) {
                            return
                          }

                          setKonvaCanvasesCursor('grab')
                        }}
                        onMouseLeave={() => {
                          if (draggingGrenadeId !== null) {
                            return
                          }

                          restoreKonvaCanvasCursor()
                        }}
                      >
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
                    </Group>
                  )
                })}
              </Group>
            </Layer>
            <Layer
              ref={drawingLayerRef}
              x={mapView.x}
              y={mapView.y}
              scaleX={mapView.scale}
              scaleY={mapView.scale}
            />
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

        <div
          className="clear-actions"
          role="group"
          aria-label="Clear ink lines or grenade markers"
        >
          <button type="button" className="clear-action-button" onClick={clearDrawing}>
            <svg
              className="clear-action-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 20h8M10 5h4l1 3h4v2H5V8l1-3Zm2 8v6m4-6v6M9 9v9"
              />
            </svg>
            <span>Clear ink</span>
          </button>
          <button type="button" className="clear-action-button" onClick={clearGrenades}>
            <svg
              className="clear-action-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                d="m8 16 8-8"
              />
            </svg>
            <span>Clear grenades</span>
          </button>
        </div>
        <div className="history-actions" aria-label="Map history controls">
          <button
            type="button"
            className="history-action-button"
            onClick={undoCurrentMapAction}
            disabled={!canUndo}
          >
            <svg
              className="history-action-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v1"
              />
            </svg>
            <span className="history-action-label">Undo</span>
            <span className="history-shortcuts">
              {modifierHintsApple ? (
                <>
                  <kbd className="tool-shortcut-hint">⌘</kbd>
                  <kbd className="tool-shortcut-hint">Z</kbd>
                </>
              ) : (
                <>
                  <kbd className="tool-shortcut-hint wide-kbd-hint">Ctrl</kbd>
                  <kbd className="tool-shortcut-hint">Z</kbd>
                </>
              )}
            </span>
          </button>
          <button
            type="button"
            className="history-action-button"
            onClick={redoCurrentMapAction}
            disabled={!canRedo}
          >
            <svg
              className="history-action-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0-5 5v1"
              />
            </svg>
            <span className="history-action-label">Redo</span>
            <span className="history-shortcuts">
              {modifierHintsApple ? (
                <>
                  <kbd className="tool-shortcut-hint">⌘</kbd>
                  <kbd className="tool-shortcut-hint">⇧</kbd>
                  <kbd className="tool-shortcut-hint">Z</kbd>
                </>
              ) : (
                <>
                  <kbd className="tool-shortcut-hint wide-kbd-hint">Ctrl</kbd>
                  <kbd className="tool-shortcut-hint wide-kbd-hint">Shift</kbd>
                  <kbd className="tool-shortcut-hint">Z</kbd>
                </>
              )}
            </span>
          </button>
        </div>
        <div className="zoom-control" aria-label="Map zoom controls">
          <button
            type="button"
            className="zoom-control-button"
            aria-label="Zoom out"
            onClick={() => changeZoomByPercent(-ZOOM_BUTTON_STEP)}
          >
            <svg className="zoom-step-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                d="M7 12h10"
              />
            </svg>
          </button>
          <button
            type="button"
            className="zoom-amount-button"
            aria-pressed={isAutoZoom}
            onClick={resetAutoZoom}
          >
            <span className="zoom-amount-inner">
              <span
                className={
                  isAutoZoom ? 'zoom-auto-label zoom-auto-label-active' : 'zoom-auto-label'
                }
              >
                Auto
              </span>
              <span className="zoom-percent-readout">{zoomPercent}%</span>
            </span>
          </button>
          <button
            type="button"
            className="zoom-control-button"
            aria-label="Zoom in"
            onClick={() => changeZoomByPercent(ZOOM_BUTTON_STEP)}
          >
            <svg className="zoom-step-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                d="M12 7v10M7 12h10"
              />
            </svg>
          </button>
        </div>
        <section className="tool-picker-section" aria-label="Drawing tools">
          <button
            type="button"
            className="mouse-legend ink-tool-button"
            aria-label="Use ink tool. On desktop, left-drag draws T-side orange and right-drag draws CT-side blue. On mobile, choose T side or CT side below."
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
          <div className="mobile-brush-color-picker" aria-label="Ink color">
            <button
              type="button"
              className="brush-color-button brush-color-button-t"
              aria-pressed={selectedBrushColor === SIDE_BRUSH_COLORS.t}
              onClick={() => handleBrushColorSelect(SIDE_BRUSH_COLORS.t)}
            >
              <span className="brush-color-swatch" aria-hidden="true" />
              <span>T side</span>
            </button>
            <button
              type="button"
              className="brush-color-button brush-color-button-ct"
              aria-pressed={selectedBrushColor === SIDE_BRUSH_COLORS.ct}
              onClick={() => handleBrushColorSelect(SIDE_BRUSH_COLORS.ct)}
            >
              <span className="brush-color-swatch" aria-hidden="true" />
              <span>CT side</span>
            </button>
          </div>
          <div className="grenade-metadata-strip" aria-live="polite">
            {selectedMapMetadata.status === 'loading' ? (
              <p className="panel-copy grenade-metadata-copy">
                Loading map scale...
              </p>
            ) : null}
            {selectedMapMetadata.status === 'error' ? (
              <p className="panel-copy metadata-warning grenade-metadata-copy">
                Map metadata failed to load; grenade radii are hidden.
              </p>
            ) : null}
          </div>
          <div className="utility-tool-grid">
            {UTILITY_TOOL_OPTIONS.map((tool) => (
              <GrenadeUtilityToolCell
                key={tool.id}
                tool={tool}
                selectedTool={selectedTool}
                onSelect={handleUtilityToolSelect}
              />
            ))}
          </div>
        </section>
        <section className="flash-overlay-panel" aria-label="Flash overlays">
          <label className="toggle-control">
            <input
              type="checkbox"
              checked={useRaycastedFlashes}
              onChange={(event) =>
                setUseRaycastedFlashes(event.target.checked)
              }
            />
            <span className="toggle-switch" aria-hidden="true" />
            <span className="toggle-label">Ray-casted Flashes</span>
          </label>
        </section>
      </aside>
    </main>
  )
}

export default App
