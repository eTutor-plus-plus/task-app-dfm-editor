// Runs inside the browser via `locator.evaluate`, so it must stay self-contained.
export function inspectGraphLayout(svg: SVGSVGElement) {
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

  function crossesBox(x1: number, y1: number, x2: number, y2: number, box: (typeof nodes)[number]) {
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

  const edgeGroups = Array.from(svg.querySelectorAll<SVGGElement>('g.edge-group')).map((group) => {
    const lines = Array.from(group.querySelectorAll<SVGLineElement>('line.edge')).map((line) => ({
      x1: Number(line.getAttribute('x1')),
      y1: Number(line.getAttribute('y1')),
      x2: Number(line.getAttribute('x2')),
      y2: Number(line.getAttribute('y2')),
    }))
    const first = lines[0]
    const last = lines[lines.length - 1]
    return { lines, name: `${nearest(first.x1, first.y1)} -> ${nearest(last.x2, last.y2)}` }
  })

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
    return t > 0.03 && t < 0.97 && u > 0.03 && u < 0.97
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

  return { nodesWithInvalidPosition, overlappingNodes, edgesCrossingNodes, crossingEdges, nodesOutsideViewport, scale }
}
