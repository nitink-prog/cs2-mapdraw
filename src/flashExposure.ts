export type FlashExposurePoint = {
  x: number
  y: number
}

export type FlashExposureTuning = {
  blockedExposureAmount: number
  blurAmount: number
  edgeSoftnessSamples: number
  falloffCurve: number
  falloffStart: number
  gridResolution: number
  maxFlashRadius: number
  rayCount: number
  wallAlphaThreshold: number
  wallColorThreshold: number
}

export type FlashExposureCanvas = {
  canvas: HTMLCanvasElement
  height: number
  width: number
  x: number
  y: number
}

type SolidGrid = {
  cellSize: number
  columns: number
  mapWorldSize: number
  rows: number
  solidCells: Uint8Array
}

type FlashExposureCanvasOptions = {
  mapImage: HTMLImageElement
  mapWorldSize: number
  origin: FlashExposurePoint
  radius: number
  tuning?: FlashExposureTuning
}

const TWO_PI = Math.PI * 2
const MIN_EXPOSURE_CANVAS_SIZE = 1
const EXPOSURE_COLOR_STOPS = [0, 0.18, 0.42, 0.68, 0.86, 1]

export const FLASH_EXPOSURE_TUNING: FlashExposureTuning = {
  blockedExposureAmount: 0.018,
  blurAmount: 2,
  edgeSoftnessSamples: 2,
  falloffCurve: 1.55,
  falloffStart: 0.22,
  gridResolution: 4,
  maxFlashRadius: 2000,
  rayCount: 720,
  wallAlphaThreshold: 240,
  wallColorThreshold: 250,
}

const solidGridCache = new WeakMap<HTMLImageElement, Map<string, SolidGrid>>()

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(MIN_EXPOSURE_CANVAS_SIZE, Math.ceil(width))
  canvas.height = Math.max(MIN_EXPOSURE_CANVAS_SIZE, Math.ceil(height))

  return canvas
}

function getRequiredContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Flash exposure canvas could not get a 2D context.')
  }

  return context
}

function getImageDimension(
  image: HTMLImageElement,
  dimension: 'height' | 'width',
) {
  const naturalDimension =
    dimension === 'height' ? image.naturalHeight : image.naturalWidth

  return Math.max(1, naturalDimension || image[dimension])
}

function getSolidGridCacheKey(
  mapWorldSize: number,
  tuning: FlashExposureTuning,
) {
  return [
    mapWorldSize,
    tuning.gridResolution,
    tuning.wallAlphaThreshold,
    tuning.wallColorThreshold,
  ].join(':')
}

function isWallPixel(
  imageData: ImageData,
  pixelX: number,
  pixelY: number,
  tuning: FlashExposureTuning,
) {
  const offset = (pixelY * imageData.width + pixelX) * 4
  const red = imageData.data[offset]
  const green = imageData.data[offset + 1]
  const blue = imageData.data[offset + 2]
  const alpha = imageData.data[offset + 3]

  return (
    alpha >= tuning.wallAlphaThreshold &&
    red >= tuning.wallColorThreshold &&
    green >= tuning.wallColorThreshold &&
    blue >= tuning.wallColorThreshold
  )
}

function createSolidGrid(
  mapImage: HTMLImageElement,
  mapWorldSize: number,
  tuning: FlashExposureTuning,
): SolidGrid {
  const imageWidth = getImageDimension(mapImage, 'width')
  const imageHeight = getImageDimension(mapImage, 'height')
  const sourceCanvas = createCanvas(imageWidth, imageHeight)
  const sourceContext = getRequiredContext(sourceCanvas)

  sourceContext.drawImage(mapImage, 0, 0, imageWidth, imageHeight)

  const imageData = sourceContext.getImageData(0, 0, imageWidth, imageHeight)
  const cellSize = tuning.gridResolution
  const columns = Math.ceil(mapWorldSize / cellSize)
  const rows = Math.ceil(mapWorldSize / cellSize)
  const solidCells = new Uint8Array(columns * rows)
  const imageScaleX = imageWidth / mapWorldSize
  const imageScaleY = imageHeight / mapWorldSize

  for (let row = 0; row < rows; row += 1) {
    const mapStartY = row * cellSize
    const mapEndY = Math.min(mapWorldSize, mapStartY + cellSize)
    const pixelStartY = Math.max(0, Math.floor(mapStartY * imageScaleY))
    const pixelEndY = Math.min(imageHeight, Math.ceil(mapEndY * imageScaleY))

    for (let column = 0; column < columns; column += 1) {
      const mapStartX = column * cellSize
      const mapEndX = Math.min(mapWorldSize, mapStartX + cellSize)
      const pixelStartX = Math.max(0, Math.floor(mapStartX * imageScaleX))
      const pixelEndX = Math.min(imageWidth, Math.ceil(mapEndX * imageScaleX))
      let isSolid = false

      for (
        let pixelY = pixelStartY;
        pixelY < pixelEndY && !isSolid;
        pixelY += 1
      ) {
        for (let pixelX = pixelStartX; pixelX < pixelEndX; pixelX += 1) {
          if (isWallPixel(imageData, pixelX, pixelY, tuning)) {
            isSolid = true
            break
          }
        }
      }

      if (isSolid) {
        solidCells[row * columns + column] = 1
      }
    }
  }

  return {
    cellSize,
    columns,
    mapWorldSize,
    rows,
    solidCells,
  }
}

function getSolidGrid(
  mapImage: HTMLImageElement,
  mapWorldSize: number,
  tuning: FlashExposureTuning,
) {
  const cacheKey = getSolidGridCacheKey(mapWorldSize, tuning)
  const cachedByKey = solidGridCache.get(mapImage)
  const cachedGrid = cachedByKey?.get(cacheKey)

  if (cachedGrid) {
    return cachedGrid
  }

  const solidGrid = createSolidGrid(mapImage, mapWorldSize, tuning)
  const nextCachedByKey = cachedByKey ?? new Map<string, SolidGrid>()

  nextCachedByKey.set(cacheKey, solidGrid)
  solidGridCache.set(mapImage, nextCachedByKey)

  return solidGrid
}

function isPointInsideMap(point: FlashExposurePoint, mapWorldSize: number) {
  return (
    point.x >= 0 &&
    point.x <= mapWorldSize &&
    point.y >= 0 &&
    point.y <= mapWorldSize
  )
}

function isSolidAt(grid: SolidGrid, point: FlashExposurePoint) {
  if (!isPointInsideMap(point, grid.mapWorldSize)) {
    return true
  }

  const column = Math.min(
    grid.columns - 1,
    Math.max(0, Math.floor(point.x / grid.cellSize)),
  )
  const row = Math.min(
    grid.rows - 1,
    Math.max(0, Math.floor(point.y / grid.cellSize)),
  )

  return grid.solidCells[row * grid.columns + column] === 1
}

function traceVisibilityRay(
  grid: SolidGrid,
  origin: FlashExposurePoint,
  angle: number,
  radius: number,
) {
  const step = Math.max(1, grid.cellSize / 2)
  const directionX = Math.cos(angle)
  const directionY = Math.sin(angle)
  let lastOpenPoint = origin

  for (let distance = step; distance <= radius; distance += step) {
    const nextPoint = {
      x: origin.x + directionX * distance,
      y: origin.y + directionY * distance,
    }

    if (!isPointInsideMap(nextPoint, grid.mapWorldSize)) {
      return lastOpenPoint
    }

    if (isSolidAt(grid, nextPoint)) {
      return lastOpenPoint
    }

    lastOpenPoint = nextPoint
  }

  return {
    x: origin.x + directionX * radius,
    y: origin.y + directionY * radius,
  }
}

function buildVisibilityPolygon(
  grid: SolidGrid,
  origin: FlashExposurePoint,
  radius: number,
  tuning: FlashExposureTuning,
) {
  // @ink:konva The overlay stays in 0..1024 map coordinates; stage zoom is applied only by App's parent Group.
  const raySamples = Math.max(
    90,
    Math.round(tuning.rayCount * Math.max(1, tuning.edgeSoftnessSamples)),
  )

  return Array.from({ length: raySamples }, (_, index) => {
    const angle = (index / raySamples) * TWO_PI

    return traceVisibilityRay(grid, origin, angle, radius)
  })
}

function drawVisibilityMask(
  maskCanvas: HTMLCanvasElement,
  polygon: FlashExposurePoint[],
  bounds: { x: number; y: number },
) {
  const context = getRequiredContext(maskCanvas)

  context.clearRect(0, 0, maskCanvas.width, maskCanvas.height)

  if (polygon.length < 3) {
    return
  }

  context.beginPath()
  context.moveTo(polygon[0].x - bounds.x, polygon[0].y - bounds.y)

  for (const point of polygon.slice(1)) {
    context.lineTo(point.x - bounds.x, point.y - bounds.y)
  }

  context.closePath()
  context.fillStyle = 'rgba(255, 255, 255, 1)'
  context.fill()
}

function getSoftenedMask(
  maskCanvas: HTMLCanvasElement,
  tuning: FlashExposureTuning,
) {
  if (tuning.blurAmount <= 0) {
    return maskCanvas
  }

  const softenedCanvas = createCanvas(maskCanvas.width, maskCanvas.height)
  const context = getRequiredContext(softenedCanvas)

  context.filter = `blur(${tuning.blurAmount}px)`
  context.drawImage(maskCanvas, 0, 0)
  context.filter = 'none'

  return softenedCanvas
}

function getExposureAlpha(
  distanceRatio: number,
  tuning: FlashExposureTuning,
) {
  if (distanceRatio <= tuning.falloffStart) {
    return 0.42
  }

  const falloffProgress =
    (distanceRatio - tuning.falloffStart) / (1 - tuning.falloffStart)

  return 0.42 * Math.pow(Math.max(0, 1 - falloffProgress), tuning.falloffCurve)
}

function getExposureColorStop(
  distanceRatio: number,
  tuning: FlashExposureTuning,
  alphaMultiplier: number,
) {
  const warmProgress = Math.min(1, Math.max(0, distanceRatio))
  const red = 255
  const green = Math.round(255 - 58 * warmProgress)
  const blue = Math.round(255 - 192 * warmProgress)
  const alpha = getExposureAlpha(distanceRatio, tuning) * alphaMultiplier

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

function drawExposureGradient(
  context: CanvasRenderingContext2D,
  origin: FlashExposurePoint,
  radius: number,
  tuning: FlashExposureTuning,
  alphaMultiplier: number,
) {
  const gradient = context.createRadialGradient(
    origin.x,
    origin.y,
    0,
    origin.x,
    origin.y,
    radius,
  )

  for (const stop of EXPOSURE_COLOR_STOPS) {
    gradient.addColorStop(
      stop,
      getExposureColorStop(stop, tuning, alphaMultiplier),
    )
  }

  context.fillStyle = gradient
  context.fillRect(0, 0, context.canvas.width, context.canvas.height)
}

export function createFlashExposureCanvas({
  mapImage,
  mapWorldSize,
  origin,
  radius,
  tuning = FLASH_EXPOSURE_TUNING,
}: FlashExposureCanvasOptions): FlashExposureCanvas {
  const solidGrid = getSolidGrid(mapImage, mapWorldSize, tuning)
  const blurPadding = Math.ceil(Math.max(0, tuning.blurAmount) * 2)
  const boundsX = Math.max(0, Math.floor(origin.x - radius - blurPadding))
  const boundsY = Math.max(0, Math.floor(origin.y - radius - blurPadding))
  const boundsRight = Math.min(
    mapWorldSize,
    Math.ceil(origin.x + radius + blurPadding),
  )
  const boundsBottom = Math.min(
    mapWorldSize,
    Math.ceil(origin.y + radius + blurPadding),
  )
  const width = Math.max(MIN_EXPOSURE_CANVAS_SIZE, boundsRight - boundsX)
  const height = Math.max(MIN_EXPOSURE_CANVAS_SIZE, boundsBottom - boundsY)
  const localOrigin = {
    x: origin.x - boundsX,
    y: origin.y - boundsY,
  }
  const polygon = buildVisibilityPolygon(solidGrid, origin, radius, tuning)
  const maskCanvas = createCanvas(width, height)
  const visibleCanvas = createCanvas(width, height)
  const canvas = createCanvas(width, height)
  const visibleContext = getRequiredContext(visibleCanvas)
  const canvasContext = getRequiredContext(canvas)

  drawVisibilityMask(maskCanvas, polygon, { x: boundsX, y: boundsY })

  if (tuning.blockedExposureAmount > 0) {
    drawExposureGradient(
      canvasContext,
      localOrigin,
      radius,
      tuning,
      tuning.blockedExposureAmount,
    )
  }

  drawExposureGradient(visibleContext, localOrigin, radius, tuning, 1)
  visibleContext.globalCompositeOperation = 'destination-in'
  visibleContext.drawImage(getSoftenedMask(maskCanvas, tuning), 0, 0)
  visibleContext.globalCompositeOperation = 'source-over'
  canvasContext.drawImage(visibleCanvas, 0, 0)

  return {
    canvas,
    height,
    width,
    x: boundsX,
    y: boundsY,
  }
}
