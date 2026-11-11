import type { DfmGraph } from '../src/types'

const names = ['day', 'month', 'year', 'city', 'region', 'country', 'customer', 'product', 'category', 'brand',
  'store', 'supplier', 'week', 'quarter', 'segment', 'district', 'zone', 'type', 'group', 'family', 'size',
  'colour', 'manager', 'department', 'division', 'salesRepresentative']
const edgeLabels = ['in', 'of', 'locatedIn', 'belongsTo', 'soldBy', 'managedBy', 'partOf', 'assignedToRegion']
const roles = ['supervisor', 'parent', 'reportsTo']

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

// Builds a graph in the shape the backend returns: facts with measures and descriptives, dimensions as trees
// of levels with descriptive leaves, optional parts, labelled edges, recursive hierarchies (self-loops with a role)
// and levels shared by several parents.
export function randomGraph(seed: number): DfmGraph {
  const random = mulberry32(seed)
  const int = (minimum: number, maximum: number) => minimum + Math.floor(random() * (maximum - minimum + 1))
  const chance = (probability: number) => random() < probability
  const pick = <T>(items: T[]) => items[int(0, items.length - 1)]

  const nodes: DfmGraph['nodes'] = []
  const edges: DfmGraph['edges'] = []
  const addEdge = (source: string, target: string, connectionType: string, optional: boolean,
    label: string | null) => {
    edges.push({ source, target, connectionType, optional, label } as DfmGraph['edges'][number])
  }

  const factCount = pick([1, 1, 1, 2, 3])
  let dimensionIndex = 0
  for (let factIndex = 0; factIndex < factCount; factIndex += 1) {
    const factId = `fact-${factIndex}`
    nodes.push({
      id: factId,
      label: `Fact${factIndex}${chance(0.2) ? 'WithLongName' : ''}`,
      type: 'FACT',
      optional: false,
      details: Array.from({ length: int(0, 4) }, (_, index) => `measure${index}`),
    })
    const descriptiveCount = chance(0.25) ? int(1, 2) : 0
    for (let index = 0; index < descriptiveCount; index += 1) {
      const id = `${factId}-descriptive-${index}`
      nodes.push({ id, label: `note${index}`, type: 'DESCRIPTIVE', optional: false, details: [] })
      addEdge(factId, id, 'SIMPLE', false, null)
    }

    const dimensionCount = int(0, factCount === 1 ? 6 : 3)
    for (let dimension = 0; dimension < dimensionCount; dimension += 1) {
      const prefix = `dimension-${dimensionIndex}-level-`
      dimensionIndex += 1
      const children = new Map<string, string[]>()
      const levels: string[] = []
      let counter = 0
      const addNode = (descriptive: boolean) => {
        const label = `${pick(names)}${counter}`
        counter += 1
        const id = prefix + label
        nodes.push({
          id,
          label,
          type: descriptive ? 'DESCRIPTIVE' : 'LEVEL',
          optional: !descriptive && chance(0.1),
          details: [],
        })
        if (!descriptive) levels.push(id)
        return id
      }

      const head = addNode(false)
      addEdge(factId, head, 'SIMPLE', false, chance(0.3) ? pick(edgeLabels) : null)
      const queue = [{ id: head, depth: 0 }]
      for (let index = 0; index < queue.length; index += 1) {
        const { id, depth } = queue[index]
        if (depth >= 4) continue
        const childCount = depth === 0 ? int(0, 3) : pick([0, 0, 1, 1, 1, 2, 3])
        for (let child = 0; child < childCount && counter < 10; child += 1) {
          const descriptive = chance(0.2)
          const childId = addNode(descriptive)
          children.set(id, [...(children.get(id) ?? []), childId])
          addEdge(id, childId, descriptive ? 'SIMPLE' : pick(['SIMPLE', 'SIMPLE', 'SIMPLE', 'MULTIPLE', 'CONVERGENCE']),
            chance(0.1), chance(0.25) ? pick(edgeLabels) : null)
          if (!descriptive) queue.push({ id: childId, depth: depth + 1 })
        }
      }

      // a level reached from a second parent (e.g. year from month and from week)
      if (levels.length >= 3 && chance(0.4)) {
        const target = pick(levels.slice(1))
        const descendants = new Set<string>([target])
        const stack = [target]
        while (stack.length > 0) {
          for (const child of children.get(stack.pop()!) ?? []) {
            descendants.add(child)
            stack.push(child)
          }
        }
        const sources = levels.filter((level) => !descendants.has(level)
          && !edges.some((edge) => edge.source === level && edge.target === target))
        if (sources.length > 0) {
          addEdge(pick(sources), target, pick(['SIMPLE', 'CONVERGENCE']), false, chance(0.2) ? pick(edgeLabels) : null)
        }
      }

      // a recursive hierarchy (a level that refers to itself with a role)
      if (chance(0.25)) {
        const level = pick(levels)
        addEdge(level, level, pick(['CONVERGENCE', 'CONVERGENCE', 'SIMPLE']), false, pick(roles))
      }
    }
  }
  return { nodes, edges }
}
