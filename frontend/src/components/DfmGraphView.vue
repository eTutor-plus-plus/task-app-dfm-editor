<script setup lang="ts">
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  select,
  drag,
  zoom,
  zoomIdentity,
  type Force,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  type ZoomBehavior,
} from 'd3'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DfmGraph, DfmNode } from '../types'
import { translate, type Locale, type TranslationKey } from '../i18n'

interface SimNode extends DfmNode, SimulationNodeDatum {}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode
  target: string | SimNode
  connectionType: string
  optional: boolean
  hidden?: boolean
}

function collisionRadius(node: SimNode) {
  if (node.type === 'FACT') return Math.max(labelWidth(node) / 2 + 12, (35 + node.details.length * 20) / 2 + 20)
  if (node.type === 'LEVEL') return Math.max(34, labelWidth(node) / 2 + 10)
  return Math.max(56, labelWidth(node) / 2 + 6)
}

const props = defineProps<{ graph: DfmGraph | null; locale: Locale }>()
const svgHost = ref<SVGSVGElement | null>(null)
const exportError = ref<TranslationKey | null>(null)
let simulation: ReturnType<typeof forceSimulation<SimNode>> | undefined
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

function labelWidth(node: SimNode) {
  if (node.type === 'FACT') {
    const longest = Math.max(node.label.length * 8, ...node.details.map((detail) => detail.length * 6.5 + 20))
    return Math.max(130, longest + 24)
  }
  if (node.type === 'DESCRIPTIVE') return Math.max(110, node.label.length * 6.6 + 12)
  return Math.max(44, node.label.length * 6.6 + 12)
}

// Places the attribute trees radially: facts are roots, leaves share the outer ring and
// inner levels sit on rings in between, so tree edges never need to cross other nodes.
function placeRadialTrees(nodes: SimNode[], edges: DfmGraph['edges']) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  edges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  })

  // Nodes with several parents (e.g. a year reached from month and calendar week) are not part of the tree.
  // They are placed between their parents, one ring further out, so their edges do not span the whole fan.
  const merges = nodes.filter((node) => node.type !== 'FACT' && (incoming.get(node.id)?.length ?? 0) > 1)
  const mergeIds = new Set(merges.map((node) => node.id))
  const mergeChildren = new Map<string, SimNode[]>()
  for (const merge of merges) {
    const queue = [merge]
    for (let index = 0; index < queue.length; index += 1) {
      for (const targetId of outgoing.get(queue[index].id) ?? []) {
        const target = byId.get(targetId)
        if (!target || mergeIds.has(targetId)) continue
        mergeChildren.set(queue[index].id, [...(mergeChildren.get(queue[index].id) ?? []), target])
        queue.push(target)
      }
    }
  }

  const levelOf = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let changed = false
    for (const edge of edges) {
      const level = (levelOf.get(edge.source) ?? 0) + 1
      if (level > (levelOf.get(edge.target) ?? 0)) {
        levelOf.set(edge.target, level)
        changed = true
      }
    }
    if (!changed) break
  }

  const children = new Map<string, SimNode[]>()
  const reached = new Set<string>()
  const owned = new Set<string>([...mergeChildren.values()].flat().map((node) => node.id))
  const roots: SimNode[] = []

  function grow(start: SimNode) {
    roots.push(start)
    reached.add(start.id)
    const queue = [start]
    for (let index = 0; index < queue.length; index += 1) {
      const parent = queue[index]
      for (const targetId of outgoing.get(parent.id) ?? []) {
        const target = byId.get(targetId)
        if (!target || reached.has(targetId) || mergeIds.has(targetId)) continue
        reached.add(targetId)
        children.set(parent.id, [...(children.get(parent.id) ?? []), target])
        queue.push(target)
      }
    }
  }

  nodes.filter((node) => node.type === 'FACT').forEach(grow)
  nodes.filter((node) => !reached.has(node.id) && !mergeIds.has(node.id) && !owned.has(node.id)).forEach((node) => {
    if (!reached.has(node.id)) grow(node)
  })
  merges.forEach((node) => {
    if (!(incoming.get(node.id) ?? []).some((source) => reached.has(source) || owned.has(source))) grow(node)
  })

  const levelGap = 90
  const treeGap = 140
  const placedMerges = new Set<string>()
  const trees: { root: SimNode; members: SimNode[] }[] = []

  for (const root of roots) {
    const depths = new Map<string, number>()
    const positions = new Map<string, number>()
    let cursor = 0
    let previousWidth = 0
    let firstWidth = 0
    let hasLeaf = false

    const visit = (node: SimNode, depth: number) => {
      depths.set(node.id, depth)
      const kids = children.get(node.id) ?? []
      if (kids.length === 0) {
        const width = labelWidth(node)
        if (hasLeaf) cursor += (previousWidth + width) / 2 + 14
        else firstWidth = width
        hasLeaf = true
        previousWidth = width
        positions.set(node.id, cursor)
        return
      }
      kids.forEach((kid) => visit(kid, depth + 1))
      positions.set(node.id, (positions.get(kids[0].id)! + positions.get(kids[kids.length - 1].id)!) / 2)
    }
    visit(root, 0)

    const treeMerges = merges.filter((node) => !placedMerges.has(node.id)
      && (incoming.get(node.id) ?? []).some((source) => depths.has(source)))
    treeMerges.forEach((node) => placedMerges.add(node.id))
    const descendantsOf = (node: SimNode): SimNode[] =>
      (mergeChildren.get(node.id) ?? []).flatMap((kid) => [kid, ...descendantsOf(kid)])
    const mergeMembers = treeMerges.flatMap((node) => [node, ...descendantsOf(node)])

    const maxDepth = Math.max(
      ...[...depths.keys(), ...mergeMembers.map((node) => node.id)].map((id) => levelOf.get(id) ?? 0),
    )
    const branchCount = (children.get(root.id) ?? []).length
    // Few branches fan out in a partial arc instead of wrapping around the root.
    const span = Math.min(2 * Math.PI, Math.max(1, branchCount) * ((2 * Math.PI) / 3))
    const isFullCircle = span >= 2 * Math.PI
    const totalSpan = isFullCircle
      ? cursor + (previousWidth + firstWidth) / 2 + 14
      : cursor + (previousWidth + firstWidth) / 2 + 28
    const outerRadius = maxDepth === 0
      ? 0
      : Math.max(maxDepth * levelGap, totalSpan / span)
    const ringRadius = (level: number) => (maxDepth === 0 ? 0 : (level * outerRadius) / maxDepth)

    for (const id of depths.keys()) {
      const node = byId.get(id)!
      const radius = ringRadius(levelOf.get(id) ?? 0)
      const fraction = isFullCircle
        ? (positions.get(id) ?? 0) / totalSpan
        : cursor === 0 ? 0.5 : (positions.get(id) ?? 0) / cursor
      const angle = outerRadius === 0
        ? 0
        : isFullCircle ? fraction * span : (fraction - 0.5) * (span - 28 / outerRadius)
      node.x = Math.cos(angle) * radius
      node.y = Math.sin(angle) * radius
    }

    const placeBeyond = (parent: SimNode, parentAngle: number) => {
      const kids = mergeChildren.get(parent.id) ?? []
      kids.forEach((kid, index) => {
        const radius = ringRadius(levelOf.get(kid.id) ?? 0)
        const offset = radius === 0 ? 0 : ((index - (kids.length - 1) / 2) * (labelWidth(kid) + 14)) / radius
        const angle = parentAngle + offset
        kid.x = Math.cos(angle) * radius
        kid.y = Math.sin(angle) * radius
        placeBeyond(kid, angle)
      })
    }

    for (const merge of [...treeMerges].sort((a, b) => (levelOf.get(a.id) ?? 0) - (levelOf.get(b.id) ?? 0))) {
      const directions = (incoming.get(merge.id) ?? [])
        .filter((source) => depths.has(source))
        .map((source) => byId.get(source)!)
        .map((parent) => {
          const length = Math.hypot(parent.x ?? 0, parent.y ?? 0) || 1
          return { x: (parent.x ?? 0) / length, y: (parent.y ?? 0) / length }
        })
      let directionX = directions.reduce((sum, direction) => sum + direction.x, 0)
      let directionY = directions.reduce((sum, direction) => sum + direction.y, 0)
      const length = Math.hypot(directionX, directionY)
      if (length < 0.2 * directions.length) {
        directionX = directions[0].x
        directionY = directions[0].y
      } else {
        directionX /= length
        directionY /= length
      }
      const radius = ringRadius(levelOf.get(merge.id) ?? 0)
      merge.x = directionX * radius
      merge.y = directionY * radius
      placeBeyond(merge, Math.atan2(directionY, directionX))
    }

    trees.push({ root, members: [...depths.keys()].map((id) => byId.get(id)!).concat(mergeMembers) })
  }

  // Arrange several trees in a grid that roughly matches the aspect ratio of the canvas.
  const boxes = trees.map(({ members }) => ({
    left: Math.min(...members.map((node) => (node.x ?? 0) - labelWidth(node) / 2)),
    right: Math.max(...members.map((node) => (node.x ?? 0) + labelWidth(node) / 2)),
    top: Math.min(...members.map((node) => (node.y ?? 0) - 40)),
    bottom: Math.max(...members.map((node) => (node.y ?? 0) + 40)),
  }))
  const columns = Math.max(1, Math.ceil(Math.sqrt(trees.length * 1.5)))
  const rows = Math.ceil(trees.length / columns)
  const columnWidths = Array.from({ length: columns }, (_, column) => Math.max(0,
    ...boxes.filter((_, index) => index % columns === column).map((box) => box.right - box.left)) + treeGap)
  const rowHeights = Array.from({ length: rows }, (_, row) => Math.max(0,
    ...boxes.filter((_, index) => Math.floor(index / columns) === row).map((box) => box.bottom - box.top)) + treeGap)

  trees.forEach(({ root, members }, index) => {
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
    if (root.type === 'FACT') {
      root.fx = root.x
      root.fy = root.y
    }
  })
}

function renderGraph(graph: DfmGraph | null) {
  if (!svgHost.value) return
  simulation?.stop()

  const svg = select(svgHost.value)
  svg.on('.zoom', null)
  svg.selectAll('*').remove()
  zoomBehavior = undefined
  initialZoomTransform = zoomIdentity
  if (!graph || graph.nodes.length === 0) return

  const width = 900
  const height = 600
  const nodes: SimNode[] = graph.nodes.map((node) => ({ ...node }))
  const facts = nodes.filter((node) => node.type === 'FACT')
  placeRadialTrees(nodes, graph.edges)
  const links: SimLink[] = graph.edges.map((edge) => ({ ...edge }))
  const layoutLinks = [...links]
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const initialDistances = new Map<SimLink, number>(links.map((link) => {
    const source = nodeById.get(link.source as string)
    const target = nodeById.get(link.target as string)
    return [link, Math.hypot((source?.x ?? 0) - (target?.x ?? 0), (source?.y ?? 0) - (target?.y ?? 0)) || 90]
  }))

  let simulationNodes: SimNode[] = []
  const edgeAvoidance: Force<SimNode, SimLink> = (alpha) => {
    for (const link of links) {
      if (typeof link.source === 'string' || typeof link.target === 'string') continue
      const sourceX = link.source.x ?? 0
      const sourceY = link.source.y ?? 0
      const deltaX = (link.target.x ?? 0) - sourceX
      const deltaY = (link.target.y ?? 0) - sourceY
      const lengthSquared = deltaX * deltaX + deltaY * deltaY
      if (lengthSquared === 0) continue

      for (const node of simulationNodes) {
        if (node === link.source || node === link.target) continue
        const nodeX = node.x ?? 0
        const nodeY = node.y ?? 0
        const projection = Math.max(0, Math.min(1,
          ((nodeX - sourceX) * deltaX + (nodeY - sourceY) * deltaY) / lengthSquared))
        const nearestX = sourceX + projection * deltaX
        const nearestY = sourceY + projection * deltaY
        let offsetX = nodeX - nearestX
        let offsetY = nodeY - nearestY
        let distance = Math.hypot(offsetX, offsetY)
        const minimumDistance = collisionRadius(node)

        if (distance >= minimumDistance) continue
        if (distance < 1) {
          const length = Math.sqrt(lengthSquared)
          offsetX = -deltaY / length
          offsetY = deltaX / length
          if (node.id.charCodeAt(0) % 2 === 0) {
            offsetX *= -1
            offsetY *= -1
          }
          distance = 1
        }

        const strength = (minimumDistance - distance) * alpha * 0.08 / distance
        node.vx = (node.vx ?? 0) + offsetX * strength
        node.vy = (node.vy ?? 0) + offsetY * strength
      }
    }
  }
  edgeAvoidance.initialize = (nodes) => {
    simulationNodes = nodes
  }

  svg.append('defs')
    .append('marker')
    .attr('id', 'convergence-arrow')
    .attr('viewBox', '0 0 10 10')
    .attr('refX', 8)
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
    const segmentCount = link.connectionType === 'MULTIPLE' || link.connectionType === 'CONVERGENCE'
      ? 2
      : 1
    const group = select(this)

    group.selectAll<SVGLineElement, number>('line.edge')
      .data(Array.from({ length: segmentCount }, (_, index) => index))
      .join('line')
      .attr('class', 'edge')
      .attr('marker-end', (index) => link.connectionType === 'CONVERGENCE' && index === 0
        ? 'url(#convergence-arrow)'
        : null)

    group.selectAll<SVGLineElement, number>('line.optional-edge-marker')
      .data(link.optional ? [0] : [])
      .join('line')
      .attr('class', 'optional-edge-marker')
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

      group.append('rect')
        .attr('x', -60)
        .attr('y', -nodeHeight / 2)
        .attr('width', 120)
        .attr('height', nodeHeight)
        .attr('rx', 10)
      group.append('text')
        .attr('class', 'box-label')
        .attr('text-anchor', 'middle')
        .attr('y', -(10 + measureCount * 20) / 2)
        .text(node.label)
      group.append('line')
        .attr('class', 'fact-divider')
        .attr('x1', -60)
        .attr('y1', -(50 + measureCount * 20) / 2 + 30)
        .attr('x2', 60)
        .attr('y2', -(50 + measureCount * 20) / 2 + 30)

      node.details.forEach((measure, index) => {
        const measureY = -nodeHeight / 2 + 40 + index * 20
        group.append('text')
          .attr('class', 'measure-label')
          .attr('x', -45)
          .attr('y', measureY)
          .text(measure)
        if (index < measureCount - 1) {
          group.append('line')
            .attr('class', 'fact-divider')
            .attr('x1', -50)
            .attr('y1', measureY + 5)
            .attr('x2', 50)
            .attr('y2', measureY + 5)
        }
      })
    } else if (node.type === 'LEVEL') {
      group.append('circle').attr('r', 10)
      group.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('y', 20)
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
          return link.connectionType === 'CONVERGENCE' && index === 0 ? middleX : targetX
        })
        .attr('y2', (index) => {
          if (link.connectionType === 'MULTIPLE') {
            return targetY + perpendicularY * (index === 0 ? 2.5 : -2.5)
          }
          return link.connectionType === 'CONVERGENCE' && index === 0 ? middleY : targetY
        })

      select(this).select<SVGLineElement>('line.optional-edge-marker')
        .attr('x1', middleX + perpendicularX * 5)
        .attr('y1', middleY + perpendicularY * 5)
        .attr('x2', middleX - perpendicularX * 5)
        .attr('y2', middleY - perpendicularY * 5)
    })

    nodeSelection.attr('transform', (node) => `translate(${node.x ?? 0},${node.y ?? 0})`)
  }

  simulation = forceSimulation<SimNode>(nodes)
    .force('link', forceLink<SimNode, SimLink>(layoutLinks)
      .id((node) => node.id)
      .distance((link) => initialDistances.get(link) ?? 90)
      .strength(0.25))
    .force('charge', forceManyBody<SimNode>().strength(-60))
    .force('collision', forceCollide<SimNode>()
      .radius(collisionRadius)
      .iterations(3))
    .force('edgeAvoidance', edgeAvoidance)
    .on('tick', updatePositions)

  simulation.stop()
  simulation.alpha(0.4)
  simulation.tick(200)
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

  nodeSelection.call(
    drag<SVGGElement, SimNode>()
      .on('start', (event, node) => {
        if (!event.active) simulation?.alphaTarget(0.25).restart()
        node.fx = node.x
        node.fy = node.y
      })
      .on('drag', (event, node) => {
        node.fx = event.x
        node.fy = event.y
      })
      .on('end', (event, node) => {
        if (!event.active) simulation?.alphaTarget(0)
        if (!facts.includes(node)) {
          node.fx = null
          node.fy = null
        }
      }),
  )
}

watch(() => props.graph, renderGraph, { deep: true })
onMounted(() => renderGraph(props.graph))
onBeforeUnmount(() => simulation?.stop())
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
