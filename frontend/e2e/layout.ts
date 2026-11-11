// Runs inside the browser via `locator.evaluate`, so it must stay self-contained.
export function inspectGraphLayout(svg: SVGSVGElement) {
  // A large model is fitted into the canvas at a small zoom, and Chromium then lays out text wider than at its real
  // size. Without font hinting the measured sizes do not depend on the zoom.
  const textRendering = svg.style.getPropertyValue('text-rendering')
  svg.style.setProperty('text-rendering', 'geometricPrecision')
  const number = '[-+]?\\d*\\.?\\d+(?:e[-+]?\\d+)?'
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('g.graph-node')).map((node) => {
    const position = new RegExp(`translate\\((${number}),\\s*(${number})\\)`, 'i')
      .exec(node.getAttribute('transform') ?? '')
    const bounds = node.getBBox()
    const screen = node.getBoundingClientRect()
    const x = Number(position?.[1] ?? 0)
    const y = Number(position?.[2] ?? 0)
    return {
      label: node.querySelector('text')?.textContent ?? '',
      isLevel: node.classList.contains('level'),
      validPosition: position !== null && Number.isFinite(x) && Number.isFinite(y),
      centerX: x,
      centerY: y,
      left: x + bounds.x,
      top: y + bounds.y,
      right: x + bounds.x + bounds.width,
      bottom: y + bounds.y + bounds.height,
      screen: { left: screen.left, top: screen.top, right: screen.right, bottom: screen.bottom },
    }
  })

  const overlappingNodes = nodes.flatMap((first, index) => nodes.slice(index + 1)
    .filter((second) => first.left < second.right
      && first.right > second.left
      && first.top < second.bottom
      && first.bottom > second.top)
    .map((second) => `${first.label} / ${second.label}`))

  function crossesBox(
    x1: number, y1: number, x2: number, y2: number,
    box: { left: number; top: number; right: number; bottom: number },
  ) {
    const dx = x2 - x1
    const dy = y2 - y1
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

    return clip(-dx, x1 - box.left)
      && clip(dx, box.right - x1)
      && clip(-dy, y1 - box.top)
      && clip(dy, box.bottom - y1)
      && maximum - minimum > 0.02
  }

  const nearest = (x: number, y: number) => nodes
    .map((node) => ({ label: node.label, distance: Math.hypot(node.centerX - x, node.centerY - y) }))
    .sort((first, second) => first.distance - second.distance)[0].label

  const edgesCrossingNodes = Array.from(svg.querySelectorAll<SVGLineElement>('g.edge-group line.edge'))
    .flatMap((line) => {
      const x1 = Number(line.getAttribute('x1'))
      const y1 = Number(line.getAttribute('y1'))
      const x2 = Number(line.getAttribute('x2'))
      const y2 = Number(line.getAttribute('y2'))
      return nodes
        .filter((node) => Math.hypot(node.centerX - x1, node.centerY - y1) >= 5
          && Math.hypot(node.centerX - x2, node.centerY - y2) >= 5
          && crossesBox(x1, y1, x2, y2, node))
        .map((node) => `${nearest(x1, y1)} -> ${nearest(x2, y2)} crosses ${node.label}`)
    })

  // self-loops are drawn as a path and have no lines
  const edgeGroups = Array.from(svg.querySelectorAll<SVGGElement>('g.edge-group')).map((group) => {
    const lines = Array.from(group.querySelectorAll<SVGLineElement>('line.edge')).map((line) => ({
      x1: Number(line.getAttribute('x1')),
      y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')),
      y2: Number(line.getAttribute('y2')),
    }))
    const first = lines[0]
    const last = lines[lines.length - 1]
    return { lines, name: first ? `${nearest(first.x1, first.y1)} -> ${nearest(last.x2, last.y2)}` : '' }
  }).filter((group) => group.lines.length > 0)

  function properCrossing(first: (typeof edgeGroups)[number]['lines'][number], second: typeof first) {
    const rx = first.x2 - first.x1
    const ry = first.y2 - first.y1
    const sx = second.x2 - second.x1
    const sy = second.y2 - second.y1
    const denominator = rx * sy - ry * sx
    if (Math.abs(denominator) < 1e-9) return false
    const qx = second.x1 - first.x1
    const qy = second.y1 - first.y1
    const t = (qx * sy - qy * sx) / denominator
    const u = (qx * ry - qy * rx) / denominator
    if (!(t > 0.03 && t < 0.97 && u > 0.03 && u < 0.97)) return false
    // The two lines of a double edge leave a node side by side, so they meet the lines of a neighbouring edge
    // right at the node. Nodes are drawn above the edges, so a crossing below a node is not visible.
    const x = first.x1 + t * rx
    const y = first.y1 + t * ry
    return !nodes.some((node) => node.isLevel
      ? Math.hypot(x - node.centerX, y - node.centerY) <= 11
      : x >= node.left && x <= node.right && y >= node.top && y <= node.bottom)
  }

  const crossingEdges = edgeGroups.flatMap((first, index) => edgeGroups.slice(index + 1)
    .filter((second) => first.lines.some((a) => second.lines.some((b) => properCrossing(a, b))))
    .map((second) => `${first.name} x ${second.name}`))

  const viewport = svg.getBoundingClientRect()
  const nodesOutsideViewport = nodes
    .filter((node) => node.screen.left < viewport.left
      || node.screen.top < viewport.top
      || node.screen.right > viewport.right
      || node.screen.bottom > viewport.bottom)
    .map((node) => node.label)

  const scale = Number(
    new RegExp(`scale\\((${number})\\)`, 'i')
      .exec(svg.querySelector('g.graph-content')?.getAttribute('transform') ?? '')?.[1] ?? 1,
  )

  const nodesWithInvalidPosition = nodes.filter((node) => !node.validPosition).map((node) => node.label)

  const intersects = (first: { left: number; top: number; right: number; bottom: number }, second: typeof first) =>
    first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top

  const edgeLabels = Array.from(svg.querySelectorAll<SVGGElement>('g.edge-group')).flatMap((group, index) => {
    const text = group.querySelector<SVGTextElement>('text.edge-label')
    if (!text) return []
    const box = text.getBBox()
    return [{
      text: text.textContent ?? '',
      group: index,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }]
  })

  // an edge label hidden behind a node (e.g. the box of a fact) cannot be read
  const labelsCoveredByNodes = edgeLabels.flatMap((label) => nodes
    .filter((node) => intersects(label, node))
    .map((node) => `${label.text} / ${node.label}`))

  const overlappingLabels = edgeLabels.flatMap((first, index) => edgeLabels.slice(index + 1)
    .filter((second) => intersects(first, second))
    .map((second) => `${first.text} / ${second.text}`))

  // a label that sits on the line of a different edge is easily read as belonging to that edge
  const labelsOnForeignEdges = edgeLabels.flatMap((label) => Array.from(
    svg.querySelectorAll<SVGLineElement>('g.edge-group line.edge'),
  )
    .filter((line) => Array.from(svg.querySelectorAll('g.edge-group')).indexOf(line.parentElement as Element)
      !== label.group)
    .filter((line) => crossesBox(
      Number(line.getAttribute('x1')), Number(line.getAttribute('y1')),
      Number(line.getAttribute('x2')), Number(line.getAttribute('y2')),
      label,
    ))
    .map(() => label.text))

  // the loop of a recursive hierarchy and its role must not cover other nodes
  const loopsCoveringNodes = Array.from(svg.querySelectorAll<SVGPathElement>('g.edge-group path.edge'))
    .flatMap((path) => {
      const box = path.getBBox()
      const start = path.getPointAtLength(0)
      const own = nodes
        .map((node) => ({ node, distance: Math.hypot(node.centerX - start.x, node.centerY - start.y) }))
        .sort((first, second) => first.distance - second.distance)[0].node
      const role = path.parentElement?.querySelector<SVGTextElement>('text.edge-label')
      const areas = [{ left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height }]
      if (role) {
        const roleBox = role.getBBox()
        areas.push({ left: roleBox.x, top: roleBox.y, right: roleBox.x + roleBox.width, bottom: roleBox.y + roleBox.height })
      }
      return nodes
        .filter((node) => node !== own && areas.some((area) => intersects(area, node)))
        .map((node) => `${role?.textContent ?? own.label} / ${node.label}`)
    })

  // longest edge between node borders, in diagram units; very long edges make hierarchies fall apart
  const longestEdge = Math.max(0, ...Array.from(svg.querySelectorAll<SVGGElement>('g.edge-group')).map((group) => {
    const line = group.querySelector<SVGLineElement>('line.edge')
    return line
      ? Math.hypot(Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
        Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')))
      : 0
  }))

  svg.style.setProperty('text-rendering', textRendering)
  return {
    nodesWithInvalidPosition,
    overlappingNodes,
    edgesCrossingNodes,
    crossingEdges,
    nodesOutsideViewport,
    labelsCoveredByNodes,
    overlappingLabels,
    labelsOnForeignEdges,
    loopsCoveringNodes,
    longestEdge,
    scale,
  }
}
