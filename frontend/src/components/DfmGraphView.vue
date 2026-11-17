<script setup lang="ts">
import { select, zoom, zoomIdentity, type ZoomBehavior } from 'd3'
import { onMounted, ref, watch } from 'vue'
import type { DfmEdge, DfmGraph, DfmNode } from '../types'
import { translate, type Locale, type TranslationKey } from '../i18n'

interface SimNode extends DfmNode {
  x?: number
  y?: number
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
  connectionType: string
  optional: boolean
  label?: string | null
  parallelOffset?: number
  hidden?: boolean
  // distance by which the layout moved the label along the edge
  labelShift?: number
}

function factHalfHeight(node: SimNode) {
  return (35 + node.details.length * 20) / 2
}

const SHARED_RING_GAP = 4

// levels, shared hierarchies and cross-dimensional attributes are drawn as circles
function isCircle(node: SimNode) {
  return node.type === 'LEVEL' || node.type === 'SHARED' || node.type === 'CROSS'
}

// distance from the center of a node to its border in the direction (unitX, unitY)
function borderDistance(node: SimNode, unitX: number, unitY: number) {
  if (node.type === 'SHARED') return 10 + SHARED_RING_GAP
  if (isCircle(node)) return 10
  const halfWidth = node.type === 'FACT' ? labelWidth(node) / 2 : 50
  const halfHeight = node.type === 'FACT' ? factHalfHeight(node) : 10
  const horizontal = Math.abs(unitX) < 1e-9 ? Infinity : halfWidth / Math.abs(unitX)
  const vertical = Math.abs(unitY) < 1e-9 ? Infinity : halfHeight / Math.abs(unitY)
  return Math.min(horizontal, vertical)
}

const SELF_LOOP_HEIGHT = 38
const SELF_LOOP_HALF_WIDTH = 26
const SELF_LOOP_HALF_GAP = 6
const MAX_LOOP_CLEARANCE = 70 * Math.PI / 180
const LEVEL_RADIUS = 10

function crossArcPath(angles: number[]) {
  const radius = LEVEL_RADIUS + SHARED_RING_GAP
  const fullTurn = 2 * Math.PI
  const sorted = angles.map((angle) => (angle + fullTurn) % fullTurn).sort((a, b) => a - b)
  let start = -Math.PI
  let span = Math.PI
  if (sorted.length > 0) {
    let largestGap = -1
    let first = 0
    sorted.forEach((angle, index) => {
      const next = index + 1 < sorted.length ? sorted[index + 1] : sorted[0] + fullTurn
      if (next - angle > largestGap) {
        largestGap = next - angle
        first = (index + 1) % sorted.length
      }
    })
    const covered = fullTurn - largestGap
    span = Math.min(fullTurn, Math.max(Math.PI, covered + Math.PI / 12))
    start = sorted[first] - (span - covered) / 2
  }
  const point = (angle: number) => `${radius * Math.cos(angle)} ${radius * Math.sin(angle)}`
  return `M ${point(start)} A ${radius} ${radius} 0 0 1 ${point(start + span / 2)}`
    + ` A ${radius} ${radius} 0 0 1 ${point(start + span)}`
}

// Find the last intersection of a rendered edge segment with the circle around its target.
function incomingArcAngle(segment: SVGGeometryElement, target: SimNode): number | undefined {
  const radius = LEVEL_RADIUS + SHARED_RING_GAP
  const length = segment.getTotalLength()
  const x = target.x ?? 0, y = target.y ?? 0
  const distance = (position: number) => {
    const point = segment.getPointAtLength(position)
    return Math.hypot(point.x - x, point.y - y)
  }
  let inside = length
  if (distance(inside) > radius) return undefined
  for (let i = 1; i <= 64; i += 1) {
    let outside = length * (1 - i / 64)
    if (distance(outside) >= radius) {
      for (let j = 0; j < 24; j += 1) {
        const middle = (outside + inside) / 2
        if (distance(middle) >= radius) outside = middle
        else inside = middle
      }
      const point = segment.getPointAtLength((outside + inside) / 2)
      return Math.atan2(point.y - y, point.x - x)
    }
    inside = outside
  }
  return undefined
}

type LinkEnd = string | { id: string }

function endId(end: LinkEnd) {
  return typeof end === 'string' ? end : end.id
}

// a self-loop connects a level to itself (recursive hierarchy)
function isSelfLink(link: { source: LinkEnd; target: LinkEnd }) {
  return endId(link.source) === endId(link.target)
}

// Geometry of a self-loop at a positioned node. The loop points upwards (the name of a level hangs below the node)
// and as far away from the connected edges as possible.
function selfLoopShape(node: SimNode, links: SimLink[], label?: string | null, offset = 0) {
  const x = node.x ?? 0
  const y = node.y ?? 0

  const neighborAngles: number[] = []
  for (const link of links) {
    if (isSelfLink(link) || typeof link.source === 'string' || typeof link.target === 'string') continue
    const other = link.source === node ? link.target : link.target === node ? link.source : null
    if (other) neighborAngles.push(Math.atan2((other.y ?? 0) - y, (other.x ?? 0) - x))
  }

  // among the upward directions the one with the largest angular distance to all connected edges wins;
  // without a clear difference the loop points straight up
  let bestAngle = -Math.PI / 2
  let bestScore = -Infinity
  for (let degrees = -150; degrees <= -30; degrees += 5) {
    const angle = degrees * Math.PI / 180
    const clearance = Math.min(
      MAX_LOOP_CLEARANCE,
      ...neighborAngles.map((other) => Math.abs(Math.atan2(Math.sin(angle - other), Math.cos(angle - other)))),
    )
    const score = clearance - Math.abs(angle + Math.PI / 2) * 0.01
    if (score > bestScore) {
      bestScore = score
      bestAngle = angle
    }
  }
  const directionX = Math.cos(bestAngle)
  const directionY = Math.sin(bestAngle)
  const perpendicularX = -directionY
  const perpendicularY = directionX

  const radius = node.type === 'SHARED' ? LEVEL_RADIUS + SHARED_RING_GAP : LEVEL_RADIUS
  const startAlong = Math.sqrt(radius * radius - SELF_LOOP_HALF_GAP * SELF_LOOP_HALF_GAP)
  const controlAlong = radius + SELF_LOOP_HEIGHT + offset
  const point = (across: number, along: number) => ({
    x: x + perpendicularX * across + directionX * along,
    y: y + perpendicularY * across + directionY * along,
  })
  const start = point(-SELF_LOOP_HALF_GAP, startAlong)
  const end = point(SELF_LOOP_HALF_GAP, startAlong)
  const first = point(-SELF_LOOP_HALF_WIDTH, controlAlong)
  const second = point(SELF_LOOP_HALF_WIDTH, controlAlong)
  const path = `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}`

  const tip = 0.75 * controlAlong + 0.25 * startAlong
  const halfWidth = (label?.length ?? 0) * 6.6 / 2
  const extent = Math.abs(directionX) * halfWidth + Math.abs(directionY) * 7
  let labelCenter = point(0, tip + 9 + extent)
  const outermostOffset = Math.max(0, ...links.filter((link) => isSelfLink(link) && endId(link.source) === node.id)
    .map((link) => link.parallelOffset ?? 0))
  if (offset < outermostOffset) {
    const outerControl = radius + SELF_LOOP_HEIGHT + outermostOffset + 4
    const outerLeft = Math.min(start.x, end.x, point(-SELF_LOOP_HALF_WIDTH, outerControl).x,
      point(SELF_LOOP_HALF_WIDTH, outerControl).x)
    labelCenter = { x: outerLeft - halfWidth - 9, y: point(0, tip).y }
  }
  const markerStart = point(0, tip - 5)
  const markerEnd = point(0, tip + 5)
  const labelHalfHeight = label ? 7 : 0
  const xs = [start.x, end.x, first.x, second.x, labelCenter.x - halfWidth, labelCenter.x + halfWidth]
  const ys = [start.y, end.y, first.y, second.y, labelCenter.y - labelHalfHeight, labelCenter.y + labelHalfHeight]

  return {
    path,
    markerStart,
    markerEnd,
    labelX: labelCenter.x,
    labelY: labelCenter.y,
    // area of the loop and its role
    bounds: { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) },
  }
}

const props = defineProps<{ graph: DfmGraph | null; locale: Locale }>()
const svgHost = ref<SVGSVGElement | null>(null)
const exportError = ref<TranslationKey | null>(null)
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | undefined
let initialZoomTransform = zoomIdentity

function changeZoom(scale: number) {
  if (!svgHost.value || !zoomBehavior) return
  select(svgHost.value).call(zoomBehavior.scaleBy, scale)
}

function resetZoom() {
  if (!svgHost.value || !zoomBehavior) return
  select(svgHost.value).call(zoomBehavior.transform, initialZoomTransform)
}

async function exportPng() {
  if (!svgHost.value || !props.graph?.nodes.length) return
  exportError.value = null

  try {
    const sourceSvg = svgHost.value
    const exportedSvg = sourceSvg.cloneNode(true) as SVGSVGElement
    const viewBox = (sourceSvg.getAttribute('viewBox') ?? '0 0 900 600')
      .split(/\s+/)
      .map(Number)
    const width = viewBox[2] || 900
    const height = viewBox[3] || 600
    const scale = 2
    exportedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    exportedSvg.setAttribute('width', String(width * scale))
    exportedSvg.setAttribute('height', String(height * scale))

    const sourceElements: SVGElement[] = [sourceSvg, ...sourceSvg.querySelectorAll<SVGElement>('*')]
    const clonedElements: SVGElement[] = [exportedSvg, ...exportedSvg.querySelectorAll<SVGElement>('*')]
    const styleProperties = [
      'fill',
      'fill-opacity',
      'stroke',
      'stroke-width',
      'stroke-opacity',
      'stroke-linecap',
      'stroke-linejoin',
      'font-family',
      'font-size',
      'font-weight',
      'text-anchor',
      'dominant-baseline',
    ]
    sourceElements.forEach((element, index) => {
      const computedStyle = getComputedStyle(element)
      styleProperties.forEach((property) => {
        clonedElements[index].style.setProperty(property, computedStyle.getPropertyValue(property))
      })
    })

    const defs = exportedSvg.querySelector('defs') ?? document.createElementNS(
      'http://www.w3.org/2000/svg',
      'defs',
    )
    if (!defs.parentNode) exportedSvg.insertBefore(defs, exportedSvg.firstChild)
    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
    pattern.setAttribute('id', 'export-dot-grid')
    pattern.setAttribute('width', '20')
    pattern.setAttribute('height', '20')
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('cx', '0')
    dot.setAttribute('cy', '0')
    dot.setAttribute('r', '0.75')
    dot.setAttribute('fill', '#e4e7ec')
    pattern.append(dot)
    defs.append(pattern)

    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    background.setAttribute('width', String(width))
    background.setAttribute('height', String(height))
    background.setAttribute('fill', '#fcfcfd')
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    grid.setAttribute('width', String(width))
    grid.setAttribute('height', String(height))
    grid.setAttribute('fill', 'url(#export-dot-grid)')
    exportedSvg.insertBefore(grid, defs.nextSibling)
    exportedSvg.insertBefore(background, grid)

    const svgUrl = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(exportedSvg)],
      { type: 'image/svg+xml;charset=utf-8' },
    ))

    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Diagram image load failed.'))
        image.src = svgUrl
      })

      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const context = canvas.getContext('2d')
      if (!context) throw new Error('PNG rendering is not supported.')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)

      const pngBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Could not create PNG image.'))
        }, 'image/png')
      })
      const pngUrl = URL.createObjectURL(pngBlob)
      const download = document.createElement('a')
      download.href = pngUrl
      download.download = `dfm-visualisierung-${new Date().toISOString().slice(0, 10)}.png`
      download.click()
      setTimeout(() => URL.revokeObjectURL(pngUrl), 0)
    } finally {
      URL.revokeObjectURL(svgUrl)
    }
  } catch (error) {
    console.error('PNG export failed', error)
    exportError.value = 'pngExportFailed'
  }
}

const MAX_FACT_WIDTH = 320

function truncate(text: string, maxChars: number) {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text
}

function labelWidth(node: SimNode) {
  if (node.type === 'FACT') {
    const longest = Math.max(node.label.length * 8, ...node.details.map((detail) => detail.length * 6.5 + 20))
    return Math.min(MAX_FACT_WIDTH, Math.max(130, longest + 24))
  }
  if (node.type === 'DESCRIPTIVE') return Math.max(110, node.label.length * 6.6 + 12)
  return Math.max(44, node.label.length * 6.6 + 12)
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

// bounding box of a positioned node including its name
function nodeBox(node: SimNode, padding = 0): Box {
  const x = node.x ?? 0
  const y = node.y ?? 0
  const radius = node.type === 'CROSS' ? LEVEL_RADIUS + SHARED_RING_GAP : LEVEL_RADIUS
  let halfWidth = Math.max(radius, node.label.length * 3.3 + 3)
  let top = -radius
  let bottom = node.type === 'CROSS' ? 36 : 26
  if (node.type === 'FACT') {
    halfWidth = Math.max(60, labelWidth(node) / 2)
    top = -factHalfHeight(node)
    bottom = factHalfHeight(node)
  } else if (node.type === 'DESCRIPTIVE') {
    halfWidth = Math.max(50, node.label.length * 3.3 + 3)
    bottom = 10
  }
  return {
    left: x - halfWidth - padding,
    top: y + top - padding,
    right: x + halfWidth + padding,
    bottom: y + bottom + padding,
  }
}

function boxesOverlap(first: Box, second: Box) {
  return first.left < second.right && first.right > second.left
    && first.top < second.bottom && first.bottom > second.top
}

function segmentCrossesBox(x1: number, y1: number, x2: number, y2: number, box: Box) {
  const deltaX = x2 - x1
  const deltaY = y2 - y1
  let minimum = 0
  let maximum = 1
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-9) return q >= 0
    const ratio = q / p
    if (p < 0) {
      if (ratio > maximum) return false
      minimum = Math.max(minimum, ratio)
    } else {
      if (ratio < minimum) return false
      maximum = Math.min(maximum, ratio)
    }
    return true
  }
  return clip(-deltaX, x1 - box.left) && clip(deltaX, box.right - x1)
    && clip(-deltaY, y1 - box.top) && clip(deltaY, box.bottom - y1)
    && maximum > minimum
}

function edgeCrossesBox(source: SimNode, target: SimNode, offset: number | undefined, box: Box) {
  const sx = source.x ?? 0, sy = source.y ?? 0, tx = target.x ?? 0, ty = target.y ?? 0
  if (offset === undefined) return segmentCrossesBox(sx, sy, tx, ty, box)
  const length = Math.hypot(tx - sx, ty - sy) || 1
  const px = -(ty - sy) / length, py = (tx - sx) / length
  let x = sx, y = sy
  for (let i = 1; i <= 24; i += 1) {
    const t = i / 24
    const bend = 4 * t * (1 - t) * offset
    const nextX = sx + (tx - sx) * t + px * bend
    const nextY = sy + (ty - sy) * t + py * bend
    if (segmentCrossesBox(x, y, nextX, nextY, box)) return true
    x = nextX
    y = nextY
  }
  return false
}

interface Point {
  x: number
  y: number
}

// the line of an edge as points; parallel edges are curved
function edgePoints(source: SimNode, target: SimNode, offset: number | undefined): Point[] {
  const sx = source.x ?? 0, sy = source.y ?? 0, tx = target.x ?? 0, ty = target.y ?? 0
  if (!offset) return [{ x: sx, y: sy }, { x: tx, y: ty }]
  const length = Math.hypot(tx - sx, ty - sy) || 1
  const px = -(ty - sy) / length, py = (tx - sx) / length
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24
    const bend = 4 * t * (1 - t) * offset
    return { x: sx + (tx - sx) * t + px * bend, y: sy + (ty - sy) * t + py * bend }
  })
}

// Whether two edges cross where it can be seen; nodes are drawn above the edges that end at them.
function edgesCross(first: Point[], second: Point[], ends: SimNode[]) {
  for (let i = 1; i < first.length; i += 1) {
    const ax = first[i - 1].x, ay = first[i - 1].y
    const rx = first[i].x - ax, ry = first[i].y - ay
    for (let j = 1; j < second.length; j += 1) {
      const bx = second[j - 1].x, by = second[j - 1].y
      const sx = second[j].x - bx, sy = second[j].y - by
      const denominator = rx * sy - ry * sx
      if (Math.abs(denominator) < 1e-9) continue
      const t = ((bx - ax) * sy - (by - ay) * sx) / denominator
      const u = ((bx - ax) * ry - (by - ay) * rx) / denominator
      if (t < 0 || t > 1 || u < 0 || u > 1) continue
      const x = ax + t * rx, y = ay + t * ry
      const hidden = ends.some((node) => {
        const deltaX = x - (node.x ?? 0), deltaY = y - (node.y ?? 0)
        const distance = Math.hypot(deltaX, deltaY)
        return distance < 1e-6 || distance <= borderDistance(node, deltaX / distance, deltaY / distance) + 2
      })
      if (!hidden) return true
    }
  }
  return false
}

// Center of the label of an edge. Optional edges keep their middle free for the marker;
// convergence edges reserve space at the target for the arrow.
function edgeLabelCenter(
  link: { label?: string | null; optional: boolean; connectionType: string; parallelOffset?: number },
  source: SimNode,
  target: SimNode,
  shift = 0,
) {
  const sourceX = source.x ?? 0
  const sourceY = source.y ?? 0
  const deltaX = (target.x ?? 0) - sourceX
  const deltaY = (target.y ?? 0) - sourceY
  const length = Math.hypot(deltaX, deltaY) || 1
  const unitX = deltaX / length
  const unitY = deltaY / length
  const perpendicularX = -unitY
  const perpendicularY = unitX
  const withCurve = (x: number, y: number, fraction: number) => {
    const offset = (link.parallelOffset ?? 0) * 4 * fraction * (1 - fraction)
    return { x: x + perpendicularX * offset, y: y + perpendicularY * offset }
  }
  const startClip = borderDistance(source, unitX, unitY)
  const endClip = borderDistance(target, -unitX, -unitY) + (link.connectionType === 'CONVERGENCE' ? 12 : 0)
  const visibleLength = length - startClip - endClip
  const visibleMiddleX = sourceX + deltaX / 2 + unitX * (startClip - endClip) / 2
  const visibleMiddleY = sourceY + deltaY / 2 + unitY * (startClip - endClip) / 2
  const labelHalfWidth = (link.label?.length ?? 0) * 6.6 / 2
  const labelHalfHeight = 7
  const directionX = deltaY < 0 ? -unitX : unitX
  const directionY = Math.abs(unitY)
  const extent = Math.abs(directionX) * labelHalfWidth + Math.abs(directionY) * labelHalfHeight
  const reserveMiddle = link.optional
  if (reserveMiddle ? 9 + 2 * extent + 2 > visibleLength / 2 : 2 * extent + 2 > visibleLength) {
    // the edge is too short, so the label is placed beside the edge instead
    const side = Math.abs(perpendicularY) > 1e-6 ? (perpendicularY > 0 ? -1 : 1) : unitY > 0 ? 1 : -1
    const offset = 9 + Math.abs(perpendicularX) * labelHalfWidth + Math.abs(perpendicularY) * labelHalfHeight
    return withCurve(visibleMiddleX + perpendicularX * side * offset, visibleMiddleY + perpendicularY * side * offset,
      (startClip + length - endClip) / (2 * length))
  }
  // position along the edge, measured from the center of the source
  const middle = (startClip + length - endClip) / 2
  // The label of an optional edge lies towards the lower end, on a level edge towards the right end. The choice
  // must not depend on the direction of the edge or on rounding.
  const towardsLower = deltaY < -1e-6 || (Math.abs(deltaY) <= 1e-6 && deltaX < 0) ? -1 : 1
  let along = (reserveMiddle ? middle + towardsLower * (extent + 9) : middle) + shift
  along = Math.min(length - endClip - extent - 1, Math.max(startClip + extent + 1, along))
  if (reserveMiddle && towardsLower * (along - middle) < extent + 9) along = middle + towardsLower * (extent + 9)
  return withCurve(sourceX + unitX * along, sourceY + unitY * along, along / length)
}

const LEVEL_GAP = 90
const ROOT_GAP = 60
const MAX_GAP = 420
const NODE_SPACING = 16
// widest fan of children in front of a node; keeps the edges of a fan from running along their neighbours
const MAX_FAN = 150 * Math.PI / 180
// length of a lens of parallel edges relative to the bulge of its outermost line
const PARALLEL_LENGTH_RATIO = 3
const MIN_LENS_SPACING = 36

// Places every tree around its root (a fact, or the head of a dimension without a fact).
//
// Each child of the root gets its own sector, so the dimensions of a fact surround it. Inside a sector every
// node gets the angular width that its subtree needs at its own distance from the root, and children are
// centered in front of their parent. Subtrees therefore stay together and cannot run into each other.
// The length of an edge is decided per edge: it starts with a default and grows only where a label, a wide
// name or a broad fan needs more room. The layout is then checked and the offending edges are lengthened until
// nothing overlaps; there is no simulation, so the same model always yields the same picture.
// Returns how far labels were moved along their edges to get clear of other edges.
function placeTrees(nodes: SimNode[], allEdges: DfmGraph['edges']) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  // A fact with a single dimension would have the whole dimension on one side. The head of that dimension is
  // the center of the picture instead and the fact is placed like one of its levels; for the layout the
  // connections of the fact are turned around.
  const turned = new Map<DfmEdge, DfmEdge>()
  const centers = new Set<string>()
  const plainEdges = allEdges.filter((edge) => !isSelfLink(edge) && byId.has(edge.source) && byId.has(edge.target))
  for (const fact of nodes.filter((node) => node.type === 'FACT')) {
    const connections = plainEdges.filter((edge) => edge.source === fact.id || edge.target === fact.id)
    const heads = new Set(connections.map((edge) => edge.target))
    const head = heads.size === 1 ? byId.get([...heads][0])! : undefined
    if (!head || head.type === 'FACT' || connections.some((edge) => edge.source !== fact.id)
      || plainEdges.some((edge) => edge.target === head.id && edge.source !== fact.id)
      || !plainEdges.some((edge) => edge.source === head.id)) continue
    centers.add(head.id)
    for (const edge of connections) {
      turned.set(edge, {
        ...edge,
        source: edge.target,
        target: edge.source,
        parallelOffset: edge.parallelOffset === undefined ? undefined : -edge.parallelOffset,
      })
    }
  }
  // self-loops (recursive hierarchies) are not part of the tree structure
  const edges = plainEdges.map((edge) => turned.get(edge) ?? edge)
  const outgoing = new Map<string, DfmEdge[]>()
  const incoming = new Map<string, DfmEdge[]>()
  edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge])
  })
  // links with resolved ends, for the geometry of the loops of recursive hierarchies
  const resolvedLinks: SimLink[] = allEdges.flatMap((edge) => {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    return source && target ? [{ ...edge, source, target }] : []
  })
  const loops = resolvedLinks.filter((link) => isSelfLink(link))
  const loopsAt = new Map<string, SimLink[]>()
  loops.forEach((loop) => loopsAt.set(endId(loop.source), [...(loopsAt.get(endId(loop.source)) ?? []), loop]))
  // labels that the layout moved along their edge, see edgeLabelCenter
  const labelShifts = new Map<DfmEdge, number>()
  const shiftOf = (edge: DfmEdge) => labelShifts.get(edge) ?? 0
  // parallel edges between the same two nodes are drawn as a lens; how far its outermost line bulges
  const bulgeOf = (edge: DfmEdge) => edge.parallelOffset === undefined ? 0 : Math.max(0, ...edges
    .filter((other) => other.source === edge.source && other.target === edge.target)
    .map((other) => Math.abs(other.parallelOffset ?? 0)))
  // The lines of a lens lie as far apart as their labels need: side by side the labels need their width,
  // above each other only their height. Returns whether a lens changed.
  const spreadLenses = (lensEdges: DfmEdge[]) => {
    let moved = false
    const done = new Set<DfmEdge>()
    for (const edge of lensEdges) {
      if (edge.parallelOffset === undefined || done.has(edge)) continue
      const group = lensEdges.filter((other) => other.source === edge.source && other.target === edge.target)
      group.forEach((other) => done.add(other))
      const source = byId.get(edge.source)!
      const target = byId.get(edge.target)!
      const textWidth = Math.max(0, ...group.map((other) => (other.label?.length ?? 0) * 6.6))
      const direction = source.x === undefined || target.x === undefined
        ? Math.PI / 2
        : Math.atan2((target.y ?? 0) - (source.y ?? 0), target.x - source.x)
      const spacing = Math.max(MIN_LENS_SPACING,
        textWidth * Math.abs(Math.sin(direction)) + 14 * Math.abs(Math.cos(direction)) + 16)
      const side = [...turned.values()].includes(edge) ? -1 : 1
      group.forEach((other, index) => {
        const offset = side * (index - (group.length - 1) / 2) * spacing
        if (Math.abs(offset - (other.parallelOffset ?? 0)) > 0.5) moved = true
        other.parallelOffset = offset
      })
    }
    return moved
  }

  // longest path from a root; a node always lies further out than all of its parents
  const levelOf = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false
    for (const edge of edges) {
      const next = (levelOf.get(edge.source) ?? 0) + 1
      if (next > (levelOf.get(edge.target) ?? 0)) {
        levelOf.set(edge.target, next)
        changed = true
      }
    }
    if (!changed) break
  }
  const level = (id: string) => levelOf.get(id) ?? 0

  // The tree decides the order of the nodes around the root. Nodes with several parents (e.g. a year reached
  // from month and calendar week) are added afterwards, see attachMerge.
  const treeParent = new Map<string, string>()
  const treeChildren = new Map<string, string[]>()
  const reached = new Set<string>()
  const roots: SimNode[] = []
  const kidsOf = (id: string) => treeChildren.get(id) ?? []
  const isMerge = (id: string) => byId.get(id)!.type !== 'FACT'
    && new Set((incoming.get(id) ?? []).map((edge) => edge.source)).size > 1
  const attach = (parent: string, child: string) => {
    treeParent.set(child, parent)
    treeChildren.set(parent, [...kidsOf(parent), child])
  }
  const grow = (start: string) => {
    reached.add(start)
    const queue = [start]
    for (let index = 0; index < queue.length; index += 1) {
      for (const edge of outgoing.get(queue[index]) ?? []) {
        if (reached.has(edge.target) || isMerge(edge.target)) continue
        reached.add(edge.target)
        attach(queue[index], edge.target)
        queue.push(edge.target)
      }
    }
  }
  // the node itself, its tree parent, ... up to the root
  const pathToRoot = (id: string) => {
    const path = [id]
    while (treeParent.has(path[path.length - 1]) && path.length <= nodes.length) {
      path.push(treeParent.get(path[path.length - 1])!)
    }
    return path
  }
  const moveToEdge = (id: string, toEnd: boolean) => {
    const parent = treeParent.get(id)
    if (!parent) return
    const others = kidsOf(parent).filter((kid) => kid !== id)
    treeChildren.set(parent, toEnd ? [...others, id] : [id, ...others])
  }

  // A node with several parents is placed between the branches of its parents: it becomes a child of their
  // lowest common ancestor in the order around the root, while its distance still follows its real parents.
  // The parents are turned towards it, so the additional edges stay short and do not cross their branches.
  // neighbouring children that belong together because their branches meet in a common level
  const joined = new Set<string>()
  const attachMerge = (merge: string) => {
    const parents = [...new Set((incoming.get(merge) ?? []).map((edge) => edge.source))]
      .filter((parent) => reached.has(parent))
    reached.add(merge)
    const paths = parents.map(pathToRoot)
    const anchor = paths[0].find((candidate) => paths.every((path) => path.includes(candidate)))
    if (parents.length === 1 || !anchor) {
      attach(parents[0], merge)
      grow(merge)
      return
    }

    const branchOf = (path: string[]) => {
      const index = path.indexOf(anchor)
      return index > 0 ? path[index - 1] : null
    }
    const anchorKids = kidsOf(anchor)
    const branches = [...new Set(paths.map(branchOf).filter((branch): branch is string => branch !== null))]
      .sort((first, second) => anchorKids.indexOf(first) - anchorKids.indexOf(second))
    const firstIndex = anchorKids.indexOf(branches[0])
    const before = anchorKids.filter((kid, index) => index < firstIndex && !branches.includes(kid))
    const after = anchorKids.filter((kid, index) => index > firstIndex && !branches.includes(kid))

    // With an odd number of sibling branches the node continues the middle branch; otherwise it sits in the
    // gap between the two halves.
    const continuesMiddle = !parents.includes(anchor) && branches.length % 2 === 1
    const split = continuesMiddle ? (branches.length - 1) / 2 : Math.ceil(branches.length / 2)
    const parentIn = (branch: string) => parents[paths.findIndex((path) => branchOf(path) === branch)]
    if (continuesMiddle) {
      // The edges from the other branches pass the middle branch on both sides, so the branch that has the
      // least beside the common level is the one in the middle.
      const weight = (id: string): number => kidsOf(id).reduce((sum, kid) => sum + 1 + weight(kid), 0)
      const middle = branches.reduce((best, branch) =>
        weight(parentIn(branch)) < weight(parentIn(best)) ? branch : best, branches[split])
      const others = branches.filter((branch) => branch !== middle)
      branches.splice(0, branches.length, ...others.slice(0, split), middle, ...others.slice(split))
    }
    const middleParent = continuesMiddle ? parentIn(branches[split]) : null
    const cluster = continuesMiddle ? branches : [...branches.slice(0, split), merge, ...branches.slice(split)]
    cluster.slice(1).forEach((kid, index) => {
      joined.add(`${cluster[index]}|${kid}`)
      joined.add(`${kid}|${cluster[index]}`)
    })
    if (continuesMiddle) {
      treeChildren.set(anchor, [...before, ...branches, ...after])
    } else {
      treeParent.set(merge, anchor)
      treeChildren.set(anchor, [...before, ...branches.slice(0, split), merge, ...branches.slice(split), ...after])
    }
    parents.forEach((parent, index) => {
      const branch = branchOf(paths[index])
      if (!branch) return
      const position = branches.indexOf(branch)
      if (continuesMiddle && position === split) return
      for (let node = parent; node !== branch && treeParent.has(node); node = treeParent.get(node)!) {
        moveToEdge(node, position < split)
      }
    })
    if (middleParent) {
      // the common level lies in the middle of the other children of its branch
      const siblings = kidsOf(middleParent)
      const half = Math.ceil(siblings.length / 2)
      treeParent.set(merge, middleParent)
      treeChildren.set(middleParent, [...siblings.slice(0, half), merge, ...siblings.slice(half)])
    }
    grow(merge)
  }

  const placedAsLevel = new Set([...turned.values()].map((edge) => edge.target))
  nodes.filter((node) => node.type === 'FACT' && !placedAsLevel.has(node.id)).forEach((node) => {
    roots.push(node)
    grow(node.id)
  })
  nodes.forEach((node) => {
    if (reached.has(node.id) || (incoming.get(node.id)?.length ?? 0) > 0) return
    roots.push(node)
    grow(node.id)
  })
  const merges = nodes.filter((node) => isMerge(node.id)).sort((first, second) => level(first.id) - level(second.id))
  for (let guard = 0; guard <= nodes.length; guard += 1) {
    const merge = merges.find((node) => !reached.has(node.id)
      && (incoming.get(node.id) ?? []).some((edge) => reached.has(edge.source)))
    if (merge) {
      attachMerge(merge.id)
      continue
    }
    // only reachable through a cycle
    const rest = nodes.find((node) => !reached.has(node.id))
    if (!rest) break
    roots.push(rest)
    grow(rest.id)
  }

  // a fact that is placed like a level comes first, see the direction of the first child of a root
  for (const fact of placedAsLevel) {
    const head = treeParent.get(fact)
    if (head) treeChildren.set(head, [fact, ...kidsOf(head).filter((kid) => kid !== fact)])
  }

  const trees = roots.map((root) => {
    const members: SimNode[] = []
    const collect = (id: string) => {
      members.push(byId.get(id)!)
      kidsOf(id).forEach(collect)
    }
    collect(root.id)
    const inTree = new Set(members.map((node) => node.id))
    const byLevel = [...members].sort((first, second) => level(first.id) - level(second.id))
    const treeEdges = edges.filter((edge) => inTree.has(edge.source) && inTree.has(edge.target))
    const treeLoops = loops.filter((loop) => inTree.has(endId(loop.source)))

    const gaps = new Map<string, number>()
    const minimumLengths = new Map<DfmEdge, number>()
    const extraRoom = new Map<DfmEdge, number>()
    const radius = new Map<string, number>()
    const angle = new Map<string, number>()
    const width = new Map<string, number>()
    // room to the sides that the loop of a recursive hierarchy asked for, per level
    const loopRoom = new Map<string, number>()
    // gap in the middle of the children of a level with a recursive hierarchy, so that its loop fits between them
    const loopGaps = new Map<string, number>()
    const loopWindowOf = (id: string) => {
      const gap = loopGaps.get(id) ?? 0
      const kids = kidsOf(id)
      if (gap === 0 || kids.length === 0) return 0
      return gap / (Math.min(...kids.map((kid) => radius.get(kid) ?? 0)) || 1)
    }
    // all edges leaving a node share one length, so its children form an arc; single edges may be longer
    const gapOf = (source: string) => gaps.get(source)
      ?? (source === root.id && !centers.has(source) ? ROOT_GAP : LEVEL_GAP)
    // a lens of parallel edges must be long enough that its lines do not leave the node sideways
    const lengthOf = (edge: DfmEdge) => Math.max(gapOf(edge.source), minimumLengths.get(edge) ?? 0,
      PARALLEL_LENGTH_RATIO * bulgeOf(edge))
    const fanOf = (id: string) => kidsOf(id).reduce((sum, kid) => sum + (width.get(kid) ?? 0), 0) + loopWindowOf(id)

    let lensMoved = false
    const place = () => {
      lensMoved = spreadLenses(treeEdges)
      for (const node of byLevel) {
        if (node === root) {
          radius.set(node.id, 0)
          continue
        }
        // the root is a box, so its children start at its border in their direction
        const direction = angle.get(node.id) ?? Math.PI / 4
        let distance = 0
        const parentEdges = (incoming.get(node.id) ?? [])
          .filter((edge) => inTree.has(edge.source) && level(edge.source) < level(node.id))
        const nearest = Math.min(...parentEdges.map((edge) => radius.get(edge.source) ?? 0))
        for (const edge of parentEdges) {
          const start = edge.source === root.id
            ? borderDistance(root, Math.cos(direction), Math.sin(direction))
            : radius.get(edge.source) ?? 0
          // A level with parents at different distances sits beside its outer parents instead of beyond them,
          // which keeps the edge from its inner parents short.
          const beside = edge.source === treeParent.get(node.id)
            ? 0
            : Math.min(LEVEL_GAP, (radius.get(edge.source) ?? 0) - nearest)
          distance = Math.max(distance, start + lengthOf(edge) - beside)
        }
        // a fact that is placed like a level is a box as well
        if (node.type === 'FACT') distance += borderDistance(node, Math.cos(direction), Math.sin(direction))
        radius.set(node.id, distance || (radius.get(treeParent.get(node.id) ?? '') ?? 0) + LEVEL_GAP)
      }

      // angular width of every subtree: its own box at its distance, or the widths of its children
      const measure = (id: string): number => {
        const node = byId.get(id)!
        let own = 0
        if (node !== root) {
          const box = nodeBox(node)
          const direction = angle.get(id)
          let extent = direction === undefined
            ? box.right - box.left
            : (box.right - box.left) * Math.abs(Math.sin(direction))
              + (box.bottom - box.top) * Math.abs(Math.cos(direction))
          // a recursive hierarchy needs room for its loop and role next to the level
          for (const loop of loopsAt.get(id) ?? []) {
            extent = Math.max(extent, 2 * SELF_LOOP_HALF_WIDTH + 18, (loop.label?.length ?? 0) * 6.6 + 18)
          }
          // room that labels and loops asked for because something else was in their way
          const room = (incoming.get(id) ?? []).reduce((sum, edge) => sum + (extraRoom.get(edge) ?? 0), 0)
            + (loopRoom.get(id) ?? 0)
          own = 2 * Math.atan((extent + NODE_SPACING + room) / 2 / (radius.get(id) || 1))
          // a label sits on the edge from the parent and must not reach into the neighbours
          const parent = treeParent.get(id)
          const labelled = (incoming.get(id) ?? []).find((edge) => edge.source === parent && edge.label)
          if (parent && labelled) {
            const textWidth = labelled.label!.length * 6.6 + 6
            const labelExtent = direction === undefined
              ? textWidth
              : textWidth * Math.abs(Math.sin(direction)) + 18 * Math.abs(Math.cos(direction))
            let distance = ((radius.get(parent) ?? 0) + (radius.get(id) ?? 0)) / 2
            if (node.x !== undefined) {
              const center = edgeLabelCenter(labelled, byId.get(parent)!, node, shiftOf(labelled))
              distance = Math.hypot(center.x, center.y)
            }
            own = Math.max(own, 2 * Math.atan((labelExtent + 10 + room) / 2 / (distance || 1)))
          }
          // the lines of a lens of parallel edges leave the parent to the sides and carry their labels there
          const lens = (incoming.get(id) ?? []).filter((edge) => edge.source === parent && edge.parallelOffset)
          if (parent && lens.length > 0) {
            const bulge = bulgeOf(lens[0])
            const textWidth = Math.max(0, ...lens.map((edge) => (edge.label?.length ?? 0) * 6.6 + 6))
            const labelExtent = direction === undefined
              ? textWidth
              : textWidth * Math.abs(Math.sin(direction)) + 18 * Math.abs(Math.cos(direction))
            const distance = ((radius.get(parent) ?? 0) + (radius.get(id) ?? 0)) / 2
            own = Math.max(own, 2 * Math.atan((2 * bulge + labelExtent + 10 + room) / 2 / (distance || 1)))
          }
        }
        const result = Math.max(own, kidsOf(id).reduce((sum, kid) => sum + measure(kid), 0) + loopWindowOf(id))
        width.set(id, result)
        return result
      }
      const total = measure(root.id)

      const assign = (id: string, center: number) => {
        angle.set(id, center)
        const kids = kidsOf(id)
        let start = center - fanOf(id) / 2
        kids.forEach((kid, index) => {
          if (index === Math.ceil(kids.length / 2)) start += loopWindowOf(id)
          const kidWidth = width.get(kid) ?? 0
          assign(kid, start + kidWidth / 2)
          start += kidWidth
        })
      }
      // the room that is left around the root is shared equally between its children; branches that meet in a
      // common level stay next to each other
      const kids = kidsOf(root.id)
      const squeeze = total > 2 * Math.PI ? (2 * Math.PI) / total : 1
      const loose = kids.map((kid, index) => !joined.has(`${kid}|${kids[(index + 1) % kids.length]}`))
      const slack = Math.max(0, 2 * Math.PI - total) / Math.max(1, loose.filter(Boolean).length)
      const before = (index: number) => loose[(index + kids.length - 1) % kids.length] ? slack / 2 : 0
      const after = (index: number) => loose[index] ? slack / 2 : 0
      // a fact that is placed like a level lies on the left; the first child lies exactly in that direction
      const first = centers.has(root.id) ? Math.PI : 0
      let end = first
      kids.forEach((kid, index) => {
        const sector = (width.get(kid) ?? 0) * squeeze
        const center = index === 0 ? first : end + before(index) + sector / 2
        assign(kid, center)
        end = center + sector / 2 + after(index)
      })

      for (const node of members) {
        const distance = radius.get(node.id) ?? 0
        const direction = angle.get(node.id) ?? 0
        node.x = Math.cos(direction) * distance
        node.y = Math.sin(direction) * distance
      }
      return total
    }

    // Finds what is still in the way and lengthens the responsible edges. Returns whether anything changed.
    const repair = (total: number) => {
      const crowded = new Set<string>()
      const cramped = new Set<DfmEdge>()
      const blocked = new Set<DfmEdge>()
      if (total > 2 * Math.PI) crowded.add(root.id)
      for (const node of members) {
        if (node !== root && fanOf(node.id) > MAX_FAN) crowded.add(node.id)
      }

      const boxes = new Map(members.map((node) => [node.id, nodeBox(node, 3)]))
      members.forEach((first, index) => members.slice(index + 1).forEach((second) => {
        if (!boxesOverlap(boxes.get(first.id)!, boxes.get(second.id)!)) return
        const outer = (radius.get(first.id) ?? 0) >= (radius.get(second.id) ?? 0) ? first : second
        for (const edge of incoming.get(outer.id) ?? []) {
          if (inTree.has(edge.source)) crowded.add(edge.source)
        }
      }))

      const labelBox = (edge: DfmEdge, shift: number) => {
        const center = edgeLabelCenter(edge, byId.get(edge.source)!, byId.get(edge.target)!, shift)
        const halfWidth = edge.label!.length * 3.3 + 3
        return { left: center.x - halfWidth, top: center.y - 9, right: center.x + halfWidth, bottom: center.y + 9 }
      }
      const labels = treeEdges.filter((edge) => edge.label).map((edge) => ({ edge, box: labelBox(edge, shiftOf(edge)) }))
      // An edge that joins a level from another branch passes that branch. When something is in its way, both
      // of its ends move outwards, beyond what lies between the branches. Past the children of its own ends the
      // edge gets by when the joined level moves aside.
      const joins = (edge: DfmEdge) => treeParent.get(edge.target) !== edge.source
      const detoured = new Set<DfmEdge>()
      const aside = new Set<DfmEdge>()
      const avoid = (edge: DfmEdge, obstacle: string) => {
        const path = pathToRoot(obstacle)
        if (path.includes(edge.source) || path.includes(edge.target)) aside.add(edge)
        else detoured.add(edge)
      }
      for (const edge of treeEdges) {
        const source = byId.get(edge.source)!
        const target = byId.get(edge.target)!
        const crosses = (box: Box) => edgeCrossesBox(source, target, edge.parallelOffset, box)
        const inTheWay = members.filter((node) => node !== source && node !== target && crosses(nodeBox(node, 4)))
        if (joins(edge)) inTheWay.forEach((node) => avoid(edge, node.id))
        else if (inTheWay.length > 0) crowded.add(edge.source)
        if (joins(edge)) {
          const line = edgePoints(source, target, edge.parallelOffset)
          treeEdges.filter((other) => (other.source !== edge.source || other.target !== edge.target)
            && edgesCross(line, edgePoints(byId.get(other.source)!, byId.get(other.target)!, other.parallelOffset),
              [source, target, byId.get(other.source)!, byId.get(other.target)!]))
            .forEach((other) => avoid(edge, other.target))
        }
        // an edge starts and ends below the names of its own nodes, but most of it must be clear of them
        const middleX = ((source.x ?? 0) + (target.x ?? 0)) / 2
        const middleY = ((source.y ?? 0) + (target.y ?? 0)) / 2
        if (target.type !== 'FACT' && (segmentCrossesBox(middleX, middleY, target.x ?? 0, target.y ?? 0, nodeBox(source))
          || segmentCrossesBox(source.x ?? 0, source.y ?? 0, middleX, middleY, nodeBox(target)))) {
          crowded.add(edge.source)
        }
        for (const label of labels) {
          if (label.edge !== edge && crosses(label.box)) blocked.add(label.edge)
        }
      }
      // The two lines of a double edge leave a node side by side and meet the lines of a neighbouring edge
      // right there. With a small angle between the two edges that crossing would lie outside the node.
      treeEdges.forEach((first, index) => treeEdges.slice(index + 1).forEach((second) => {
        if (first.source === second.source && first.target === second.target) return
        const shared = [first.source, first.target].find((id) => id === second.source || id === second.target)
        const offset = (first.connectionType === 'MULTIPLE' ? 2.5 : 0) + (second.connectionType === 'MULTIPLE' ? 2.5 : 0)
        if (!shared || offset === 0 || !isCircle(byId.get(shared)!)) return
        const from = byId.get(shared)!
        const direction = (edge: DfmEdge) => {
          const to = byId.get(edge.source === shared ? edge.target : edge.source)!
          return Math.atan2((to.y ?? 0) - (from.y ?? 0), (to.x ?? 0) - (from.x ?? 0))
        }
        const between = direction(first) - direction(second)
        if (Math.cos(between) > 0 && offset > LEVEL_RADIUS * Math.abs(Math.sin(between))) {
          blocked.add(first)
          blocked.add(second)
        }
      }))
      // the outer lines of a lens of parallel edges need room to the sides, where they would cross other edges
      const squeezed = new Set<DfmEdge>()
      for (const edge of treeEdges) {
        if (!edge.parallelOffset) continue
        const source = byId.get(edge.source)!
        const target = byId.get(edge.target)!
        const line = edgePoints(source, target, edge.parallelOffset)
        if (treeEdges.some((other) => (other.source !== edge.source || other.target !== edge.target)
          && edgesCross(line, edgePoints(byId.get(other.source)!, byId.get(other.target)!, other.parallelOffset),
            [source, target, byId.get(other.source)!, byId.get(other.target)!]))) {
          squeezed.add(edge)
        }
      }
      labels.forEach((label, index) => {
        for (const node of members) {
          if (!boxesOverlap(label.box, nodeBox(node, 1))) continue
          if (node.id === label.edge.source || node.id === label.edge.target) cramped.add(label.edge)
          else blocked.add(label.edge)
        }
        for (const other of labels.slice(index + 1)) {
          if (!boxesOverlap(label.box, other.box)) continue
          blocked.add(label.edge)
          blocked.add(other.edge)
        }
      })
      let changed = false
      // A recursive hierarchy must keep its loop and role clear of everything else. The loop points away from the
      // edges of its level, so the level needs room to the sides and some distance from its parent. If the children
      // fan out upwards, the role would lie on their edges, so a gap is left between them for the loop.
      const crossing = (edge: DfmEdge, box: Box) => {
        const source = byId.get(edge.source)!
        const target = byId.get(edge.target)!
        return edgeCrossesBox(source, target, edge.parallelOffset, box)
      }
      for (const loop of treeLoops) {
        const node = loop.source as SimNode
        const shape = selfLoopShape(node, resolvedLinks, loop.label, loop.parallelOffset)
        if (loop.label && kidsOf(node.id).length > 0) {
          const halfWidth = loop.label.length * 3.3 + 3
          const role = { left: shape.labelX - halfWidth, top: shape.labelY - 9, right: shape.labelX + halfWidth, bottom: shape.labelY + 9 }
          if (treeEdges.some((edge) => (edge.source === node.id || edge.target === node.id) && crossing(edge, role))
            && (loopGaps.get(node.id) ?? 0) < 192) {
            loopGaps.set(node.id, (loopGaps.get(node.id) ?? 0) + 16)
            changed = true
          }
        }
        const area = { left: shape.bounds.left - 2, top: shape.bounds.top - 2, right: shape.bounds.right + 2, bottom: shape.bounds.bottom + 2 }
        const inTheWay = members.some((other) => other !== node && boxesOverlap(area, nodeBox(other)))
          || labels.some((label) => boxesOverlap(area, label.box))
          || treeEdges.some((edge) => edge.source !== node.id && edge.target !== node.id && crossing(edge, area))
          || treeLoops.some((other) => other.source !== node
            && boxesOverlap(area, selfLoopShape(other.source as SimNode, resolvedLinks, other.label, other.parallelOffset).bounds))
        if (!inTheWay) continue
        if ((loopRoom.get(node.id) ?? 0) < 192) {
          loopRoom.set(node.id, (loopRoom.get(node.id) ?? 0) + 16)
          changed = true
        }
        for (const edge of incoming.get(node.id) ?? []) {
          if (inTree.has(edge.source)) cramped.add(edge)
        }
        if (kidsOf(node.id).length > 0) crowded.add(node.id)
      }

      // A label that only meets something else (e.g. an edge that joins a node from another branch) first slides
      // along its edge to a free place. Otherwise a longer edge always helps against its own ends, and it lets a
      // label that had to move beside its edge return onto it. A label on its edge gets more room to the sides as a
      // last resort; that may not help, so it is limited.
      const isFree = (edge: DfmEdge, box: Box) =>
        !treeEdges.some((other) => other !== edge && crossing(other, box))
        && !members.some((node) => boxesOverlap(box, nodeBox(node, 1)))
        && !labels.some((label) => label.edge !== edge && boxesOverlap(box, label.box))
        && !treeLoops.some((loop) =>
          boxesOverlap(box, selfLoopShape(loop.source as SimNode, resolvedLinks, loop.label, loop.parallelOffset).bounds))
      const slide = (edge: DfmEdge) => {
        const current = labelBox(edge, shiftOf(edge))
        const length = Math.hypot((byId.get(edge.target)!.x ?? 0) - (byId.get(edge.source)!.x ?? 0),
          (byId.get(edge.target)!.y ?? 0) - (byId.get(edge.source)!.y ?? 0))
        for (let distance = 12; distance <= length; distance += 12) {
          for (const shift of [distance, -distance]) {
            const box = labelBox(edge, shift)
            if (Math.abs(box.left - current.left) < 0.5 && Math.abs(box.top - current.top) < 0.5) continue
            if (isFree(edge, box)) {
              labelShifts.set(edge, shift)
              return true
            }
          }
        }
        return false
      }
      for (const edge of blocked) {
        if (cramped.has(edge)) continue
        const source = byId.get(edge.source)!
        const target = byId.get(edge.target)!
        const center = edgeLabelCenter(edge, source, target, shiftOf(edge))
        const deltaX = (target.x ?? 0) - (source.x ?? 0)
        const deltaY = (target.y ?? 0) - (source.y ?? 0)
        const length = Math.hypot(deltaX, deltaY) || 1
        // the label of a curved edge lies on the curve
        const fraction = ((center.x - (source.x ?? 0)) * deltaX + (center.y - (source.y ?? 0)) * deltaY) / length ** 2
        const curve = (edge.parallelOffset ?? 0) * 4 * fraction * (1 - fraction)
        const besideEdge = Math.abs(((center.y - (source.y ?? 0)) * deltaX - (center.x - (source.x ?? 0)) * deltaY)
          / length - curve) > 1
        if (besideEdge) {
          cramped.add(edge)
        } else if (edge.parallelOffset) {
          squeezed.add(edge)
        } else if (edge.label && slide(edge)) {
          changed = true
        } else if ((extraRoom.get(edge) ?? 0) < 192) {
          extraRoom.set(edge, (extraRoom.get(edge) ?? 0) + 16)
          changed = true
        }
      }

      for (const edge of aside) {
        if ((extraRoom.get(edge) ?? 0) < 192) squeezed.add(edge)
        else crowded.add(edge.source)
      }
      for (const edge of squeezed) {
        if ((extraRoom.get(edge) ?? 0) >= 192) continue
        extraRoom.set(edge, (extraRoom.get(edge) ?? 0) + 16)
        changed = true
      }
      for (const source of crowded) {
        const current = gapOf(source)
        if (current >= MAX_GAP) continue
        gaps.set(source, Math.min(MAX_GAP, current * 1.12 + 6))
        changed = true
      }
      for (const edge of detoured) {
        cramped.add(edge)
        for (const other of incoming.get(edge.source) ?? []) {
          if (other.source === treeParent.get(edge.source)) cramped.add(other)
        }
      }
      for (const edge of cramped) {
        const current = lengthOf(edge)
        if (current >= MAX_GAP) continue
        minimumLengths.set(edge, Math.min(MAX_GAP, current + 14))
        changed = true
      }
      return changed
    }

    // the first passes only settle the directions, which the distances from the root box depend on
    for (let pass = 0; pass < 80; pass += 1) {
      const total = place()
      if (!repair(total) && !lensMoved && pass >= 2) break
    }
    const loopBounds = treeLoops.map((loop) => selfLoopShape(loop.source as SimNode, resolvedLinks, loop.label,
      loop.parallelOffset).bounds)
    return { root, members, loopBounds }
  })

  // Arrange several trees in a grid that roughly matches the aspect ratio of the canvas.
  const treeGap = 140
  const boxes = trees.map(({ members, loopBounds }) => ({
    left: Math.min(...members.map((node) => (node.x ?? 0) - labelWidth(node) / 2), ...loopBounds.map((box) => box.left)),
    right: Math.max(...members.map((node) => (node.x ?? 0) + labelWidth(node) / 2), ...loopBounds.map((box) => box.right)),
    top: Math.min(...members.map((node) => (node.y ?? 0) - 40), ...loopBounds.map((box) => box.top)),
    bottom: Math.max(...members.map((node) => (node.y ?? 0) + 40), ...loopBounds.map((box) => box.bottom)),
  }))
  const columns = Math.max(1, Math.ceil(Math.sqrt(trees.length * 1.5)))
  const rows = Math.ceil(trees.length / columns)
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0,
    ...boxes.filter((_, index) => index % columns === column).map((box) => box.right - box.left)) + treeGap)
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0,
    ...boxes.filter((_, index) => Math.floor(index / columns) === row).map((box) => box.bottom - box.top)) + treeGap)

  trees.forEach(({ members }, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const box = boxes[index]
    const offsetX = columnWidths.slice(0, column).reduce((sum, width) => sum + width, 0)
      + (columnWidths[column] - (box.right - box.left)) / 2 - box.left
    const offsetY = rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0)
      + (rowHeights[row] - (box.bottom - box.top)) / 2 - box.top
    members.forEach((node) => {
      node.x = (node.x ?? 0) + offsetX
      node.y = (node.y ?? 0) + offsetY
    })
  })
  // connections of a fact that were turned around for the layout
  for (const [edge, layoutEdge] of turned) {
    if (layoutEdge.parallelOffset !== undefined) edge.parallelOffset = -layoutEdge.parallelOffset
    const shift = labelShifts.get(layoutEdge)
    if (shift === undefined) continue
    labelShifts.delete(layoutEdge)
    labelShifts.set(edge, -shift)
  }
  return labelShifts
}

function renderGraph(graph: DfmGraph | null) {
  if (!svgHost.value) return

  const svg = select(svgHost.value)
  svg.on('.zoom', null)
  svg.selectAll('*').remove()
  zoomBehavior = undefined
  initialZoomTransform = zoomIdentity
  if (!graph || graph.nodes.length === 0) return

  const width = 900
  const height = 600
  // the layout is computed once and the diagram is static, only the view can be zoomed and panned
  const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node }))
  const edgeGroups = new Map<string, DfmEdge[]>()
  graph.edges.forEach((edge) => {
    const key = JSON.stringify([edge.source, edge.target])
    edgeGroups.set(key, [...(edgeGroups.get(key) ?? []), edge])
  })
  const layoutEdges = graph.edges.map((edge) => {
    const group = edgeGroups.get(JSON.stringify([edge.source, edge.target]))!
    if (group.length < 2) return { ...edge }
    if (edge.source === edge.target) return { ...edge, parallelOffset: group.indexOf(edge) * 40 }
    const spacing = Math.max(50, Math.max(...group.map((item) => item.label?.length ?? 0)) * 6.6 + 16)
    return { ...edge, parallelOffset: (group.indexOf(edge) - (group.length - 1) / 2) * spacing }
  })
  const labelShifts = placeTrees(nodes, layoutEdges)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const links: SimLink[] = layoutEdges.flatMap((edge) => {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    return source && target ? [{ ...edge, source, target, labelShift: labelShifts.get(edge) ?? 0 }] : []
  })

  svg.append('defs')
    .append('marker')
    .attr('id', 'convergence-arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 10)
    .attr('refY', 5)
    .attr('markerWidth', 7)
    .attr('markerHeight', 7)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M 0 0 L 10 5 L 0 10 z')
    .attr('fill', '#64748b')

  const content = svg.append('g').attr('class', 'graph-content')
  zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (event) => content.attr('transform', event.transform.toString()))
  svg.call(zoomBehavior)

  const edgeSelection = content.append('g')
    .attr('class', 'edges')
    .selectAll<SVGGElement, SimLink>('g')
    .data(links)
    .join('g')
    .attr('class', 'edge-group')

  edgeSelection.each(function (link) {
    const group = select(this)

    if (isSelfLink(link)) {
      group.selectAll<SVGPathElement, number>('path.edge')
        .data([0])
        .join('path')
        .attr('class', 'edge loop-edge')
        .attr('marker-end', link.connectionType === 'CONVERGENCE' ? 'url(#convergence-arrow)' : null)
      group.selectAll<SVGLineElement, number>('line.optional-edge-marker')
        .data(link.optional ? [0] : [])
        .join('line')
        .attr('class', 'optional-edge-marker')
    } else if (link.parallelOffset !== undefined) {
      const segmentCount = link.connectionType === 'MULTIPLE' || link.connectionType === 'CONVERGENCE' ? 2 : 1
      group.selectAll<SVGPathElement, number>('path.edge')
        .data(Array.from({ length: segmentCount }, (_, index) => index))
        .join('path')
        .attr('class', 'edge parallel-edge')
        .attr('marker-end', (index) => link.connectionType === 'CONVERGENCE' && index === 1
          ? 'url(#convergence-arrow)' : null)
      group.selectAll<SVGLineElement, number>('line.optional-edge-marker')
        .data(link.optional ? [0] : [])
        .join('line')
        .attr('class', 'optional-edge-marker')
    } else {
      const segmentCount = link.connectionType === 'MULTIPLE' || link.connectionType === 'CONVERGENCE'
        ? 2
        : 1

      group.selectAll<SVGLineElement, number>('line.edge')
        .data(Array.from({ length: segmentCount }, (_, index) => index))
        .join('line')
        .attr('class', 'edge')
        .attr('marker-end', (index) => link.connectionType === 'CONVERGENCE' && index === 1
          ? 'url(#convergence-arrow)'
          : null)

      group.selectAll<SVGLineElement, number>('line.optional-edge-marker')
        .data(link.optional ? [0] : [])
        .join('line')
        .attr('class', 'optional-edge-marker')
    }

    group.selectAll<SVGTextElement, string>('text.edge-label')
      .data(link.label ? [link.label] : [])
      .join('text')
      .attr('class', 'edge-label')
      .attr('text-anchor', 'middle')
      .text((label) => label)
  })

  const nodeSelection = content.append('g')
    .attr('class', 'nodes')
    .selectAll<SVGGElement, SimNode>('g')
    .data(nodes)
    .join('g')
    .attr('class', (node) => `graph-node ${node.type.toLowerCase()}${node.optional ? ' optional' : ''}`)

  nodeSelection.each(function (node) {
    const group = select(this)
    if (node.type === 'FACT') {
      const measureCount = node.details.length
      const nodeHeight = 35 + measureCount * 20

      const half = Math.max(60, labelWidth(node) / 2)

      group.append('rect')
        .attr('x', -half)
        .attr('y', -nodeHeight / 2)
        .attr('width', half * 2)
        .attr('height', nodeHeight)
        .attr('rx', 10)
      group.append('text')
        .attr('class', 'box-label')
        .attr('text-anchor', 'middle')
        .attr('y', -(10 + measureCount * 20) / 2)
        .text(truncate(node.label, Math.floor((half * 2 - 24) / 8)))
        .append('title')
        .text(node.label)
      group.append('line')
        .attr('class', 'fact-divider')
        .attr('x1', -half)
        .attr('y1', -(50 + measureCount * 20) / 2 + 30)
        .attr('x2', half)
        .attr('y2', -(50 + measureCount * 20) / 2 + 30)

      node.details.forEach((measure, index) => {
        const measureY = -nodeHeight / 2 + 40 + index * 20
        group.append('text')
          .attr('class', 'measure-label')
          .attr('x', -half + 15)
          .attr('y', measureY)
          .text(truncate(measure, Math.floor((half * 2 - 35) / 6.5)))
          .append('title')
          .text(measure)
        if (index < measureCount - 1) {
          group.append('line')
            .attr('class', 'fact-divider')
            .attr('x1', -half + 10)
            .attr('y1', measureY + 5)
            .attr('x2', half - 10)
            .attr('y2', measureY + 5)
        }
      })
    } else if (isCircle(node)) {
      if (node.type === 'SHARED') {
        group.append('circle').attr('class', 'shared-ring').attr('r', 10 + SHARED_RING_GAP)
      }
      group.append('circle').attr('r', 10)
      if (node.type === 'CROSS') {
        group.append('path')
          .attr('class', 'cross-arc')
      }
      group.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('y', node.type === 'CROSS' ? 30 : 20)
        .text(node.label)
      if (node.optional) {
        group.append('line')
          .attr('class', 'level-optional-marker')
          .attr('x1', -15)
          .attr('y1', 0)
          .attr('x2', 15)
          .attr('y2', 0)
      }
    } else if (node.type === 'DESCRIPTIVE') {
      group.append('rect')
        .attr('x', -50)
        .attr('y', -10)
        .attr('width', 100)
        .attr('height', 20)
      group.append('text')
        .attr('class', 'descriptive-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .text(node.label)
      group.append('line')
        .attr('class', 'descriptive-underline')
        .attr('x1', -50)
        .attr('y1', 10)
        .attr('x2', 50)
        .attr('y2', 10)
    }
  })

  const updatePositions = () => {
    edgeSelection.each(function (link) {
      if (isSelfLink(link)) {
        const shape = selfLoopShape(link.source as SimNode, links, link.label, link.parallelOffset)
        select(this).select('path.edge').attr('d', shape.path)
        select(this).select('line.optional-edge-marker')
          .attr('x1', shape.markerStart.x).attr('y1', shape.markerStart.y)
          .attr('x2', shape.markerEnd.x).attr('y2', shape.markerEnd.y)
        select(this).select('text.edge-label').attr('x', shape.labelX).attr('y', shape.labelY + 4)
        return
      }
      const source = link.source as SimNode
      const target = link.target as SimNode
      const sourceX = source.x ?? 0
      const sourceY = source.y ?? 0
      const targetX = target.x ?? 0
      const targetY = target.y ?? 0
      const deltaX = targetX - sourceX
      const deltaY = targetY - sourceY
      const length = Math.hypot(deltaX, deltaY) || 1
      const perpendicularX = -deltaY / length
      const perpendicularY = deltaX / length
      const middleX = (sourceX + targetX) / 2
      const middleY = (sourceY + targetY) / 2
      const targetClip = borderDistance(target, -deltaX / length, -deltaY / length)

      if (link.parallelOffset !== undefined) {
        select(this).selectAll<SVGPathElement, number>('path.edge').attr('d', (index) => {
          const offset = link.parallelOffset! + (link.connectionType === 'MULTIPLE' ? (index === 0 ? 2.5 : -2.5) : 0)
          const cx = middleX + perpendicularX * offset * 2
          const cy = middleY + perpendicularY * offset * 2
          if (link.connectionType !== 'CONVERGENCE') return `M ${sourceX} ${sourceY} Q ${cx} ${cy} ${targetX} ${targetY}`

          const point = (t: number) => ({
            x: (1 - t) ** 2 * sourceX + 2 * (1 - t) * t * cx + t ** 2 * targetX,
            y: (1 - t) ** 2 * sourceY + 2 * (1 - t) * t * cy + t ** 2 * targetY,
          })
          // Find the target border and split the truncated quadratic without changing its shape.
          let outside = 0
          let inside = 1
          for (let i = 0; i < 30; i += 1) {
            const t = (outside + inside) / 2
            const p = point(t)
            const dx = p.x - targetX
            const dy = p.y - targetY
            const distance = Math.hypot(dx, dy)
            if (distance > 0 && distance > borderDistance(target, dx / distance, dy / distance)) outside = t
            else inside = t
          }
          const end = point(outside)
          const split = outside / 2
          const mid = point(split)
          const firstControl = { x: sourceX + (cx - sourceX) * split, y: sourceY + (cy - sourceY) * split }
          const secondControl = {
            x: mid.x + split * ((1 - split) * (cx - sourceX) + split * (targetX - cx)),
            y: mid.y + split * ((1 - split) * (cy - sourceY) + split * (targetY - cy)),
          }
          return index === 0
            ? `M ${sourceX} ${sourceY} Q ${firstControl.x} ${firstControl.y} ${mid.x} ${mid.y}`
            : `M ${mid.x} ${mid.y} Q ${secondControl.x} ${secondControl.y} ${end.x} ${end.y}`
        })
      }

      select(this).selectAll<SVGLineElement, number>('line.edge')
        .attr('x1', (index) => {
          if (link.connectionType === 'MULTIPLE') {
            return sourceX + perpendicularX * (index === 0 ? 2.5 : -2.5)
          }
          return link.connectionType === 'CONVERGENCE' && index === 1 ? middleX : sourceX
        })
        .attr('y1', (index) => {
          if (link.connectionType === 'MULTIPLE') {
            return sourceY + perpendicularY * (index === 0 ? 2.5 : -2.5)
          }
          return link.connectionType === 'CONVERGENCE' && index === 1 ? middleY : sourceY
        })
        .attr('x2', (index) => {
          if (link.connectionType === 'MULTIPLE') {
            return targetX + perpendicularX * (index === 0 ? 2.5 : -2.5)
          }
          if (link.connectionType === 'CONVERGENCE') {
            return index === 0 ? middleX : targetX - deltaX / length * targetClip
          }
          return targetX
        })
        .attr('y2', (index) => {
          if (link.connectionType === 'MULTIPLE') {
            return targetY + perpendicularY * (index === 0 ? 2.5 : -2.5)
          }
          if (link.connectionType === 'CONVERGENCE') {
            return index === 0 ? middleY : targetY - deltaY / length * targetClip
          }
          return targetY
        })

      select(this).select<SVGLineElement>('line.optional-edge-marker')
        .attr('x1', middleX + perpendicularX * ((link.parallelOffset ?? 0) + 5))
        .attr('y1', middleY + perpendicularY * ((link.parallelOffset ?? 0) + 5))
        .attr('x2', middleX + perpendicularX * ((link.parallelOffset ?? 0) - 5))
        .attr('y2', middleY + perpendicularY * ((link.parallelOffset ?? 0) - 5))

      const labelCenter = edgeLabelCenter(link, source, target, link.labelShift ?? 0)
      select(this).select<SVGTextElement>('text.edge-label')
        .attr('x', labelCenter.x)
        .attr('y', labelCenter.y + 4)
    })

    nodeSelection.attr('transform', (node) => `translate(${node.x ?? 0},${node.y ?? 0})`)
    const incomingAngles = new Map<string, number[]>()
    edgeSelection.each(function (link) {
      const target = link.target as SimNode
      if (target.type !== 'CROSS') return
      const segments = Array.from(this.querySelectorAll<SVGGeometryElement>('.edge'))
      const lines = link.connectionType === 'MULTIPLE' ? segments.map((segment) => [segment]) : [segments]
      for (const line of lines) {
        let angle: number | undefined
        for (const segment of line.reverse()) {
          angle = incomingArcAngle(segment, target)
          if (angle !== undefined) break
        }
        if (angle === undefined) {
          console.warn(`Could not find the incoming edge at cross attribute ${target.id}`)
          continue
        }
        incomingAngles.set(target.id, [...(incomingAngles.get(target.id) ?? []), angle])
      }
    })
    nodeSelection.select<SVGPathElement>('path.cross-arc')
      .attr('d', (node) => crossArcPath(incomingAngles.get(node.id) ?? []))
  }

  updatePositions()

  const bounds = content.node()?.getBBox()
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const margin = 48
    const scale = Math.min(
      (width - margin * 2) / bounds.width,
      (height - margin * 2) / bounds.height,
      1,
    )
    initialZoomTransform = zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-(bounds.x + bounds.width / 2), -(bounds.y + bounds.height / 2))
    svg.call(zoomBehavior.transform, initialZoomTransform)
  }
}

watch(() => props.graph, renderGraph, { deep: true })
onMounted(() => renderGraph(props.graph))
</script>

<template>
  <div class="graph-canvas">
    <div class="graph-controls" role="group" :aria-label="translate(locale, 'zoomControls')">
      <button type="button" :aria-label="translate(locale, 'zoomIn')" :title="translate(locale, 'zoomIn')" @click="changeZoom(1.25)">+</button>
      <button type="button" :aria-label="translate(locale, 'zoomOut')" :title="translate(locale, 'zoomOut')" @click="changeZoom(0.8)">−</button>
      <button type="button" :aria-label="translate(locale, 'resetZoom')" :title="translate(locale, 'resetZoom')" @click="resetZoom">
        {{ translate(locale, 'resetZoom') }}
      </button>
      <button
        type="button"
        :disabled="!graph?.nodes.length"
        :aria-label="translate(locale, 'exportPng')"
        :title="translate(locale, 'exportPng')"
        @click="exportPng"
      >
        <svg class="export-png-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v12m-4-4 4 4 4-4M5 17v3h14v-3" />
        </svg>
      </button>
    </div>
    <p v-if="exportError" class="export-error" role="alert">{{ translate(locale, exportError) }}</p>
    <svg ref="svgHost" viewBox="0 0 900 600" role="img" :aria-label="translate(locale, 'graphImageLabel')" />
    <p v-if="!graph" class="empty-graph">{{ translate(locale, 'emptyGraph') }}</p>
  </div>
</template>
