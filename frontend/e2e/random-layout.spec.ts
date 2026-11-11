import { expect, test } from '@playwright/test'
import { inspectGraphLayout } from './layout'
import { randomGraph } from './random-models'

// Random models find layout problems that hand-written fixtures miss. The seeds are fixed, so a failure can
// be reproduced. `E2E_LAYOUT_SEEDS=61-260` checks other models, and `E2E_LAYOUT_REPORT=1` prints the findings
// of every model instead of failing.
const [firstSeed, lastSeed] = (process.env.E2E_LAYOUT_SEEDS ?? '1-60').split('-').map(Number)
const seeds = Array.from({ length: lastSeed - firstSeed + 1 }, (_, index) => firstSeed + index)
const report = Boolean(process.env.E2E_LAYOUT_REPORT)

for (const seed of seeds) {
  test(`lays out random model ${seed} without overlaps`, async ({ page }) => {
    const graph = randomGraph(seed)
    await page.route('**/api/dfm/parse', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graph),
    }))
    await page.goto('/')
    await page.locator('.cm-content').fill('fact Random { };')
    await page.getByRole('button', { name: 'Ausführen' }).click()
    const svg = page.getByRole('img', { name: 'DFM-Attributbaum' })
    await expect(svg.locator('.graph-node')).toHaveCount(graph.nodes.length)

    const layout = await svg.evaluate(inspectGraphLayout)
    const findings = {
      nodesWithInvalidPosition: layout.nodesWithInvalidPosition,
      overlappingNodes: layout.overlappingNodes,
      edgesCrossingNodes: layout.edgesCrossingNodes,
      crossingEdges: layout.crossingEdges,
      labelsCoveredByNodes: layout.labelsCoveredByNodes,
      overlappingLabels: layout.overlappingLabels,
      labelsOnForeignEdges: layout.labelsOnForeignEdges,
      loopsCoveringNodes: layout.loopsCoveringNodes,
    }
    if (report) {
      console.log(`LAYOUT ${JSON.stringify({
        seed,
        nodes: graph.nodes.length,
        longestEdge: Math.round(layout.longestEdge),
        scale: Number(layout.scale.toFixed(2)),
        ...Object.fromEntries(Object.entries(findings).map(([key, value]) => [key, value.length])),
      })}`)
      return
    }
    expect(findings).toEqual({
      nodesWithInvalidPosition: [],
      overlappingNodes: [],
      edgesCrossingNodes: [],
      crossingEdges: [],
      labelsCoveredByNodes: [],
      overlappingLabels: [],
      labelsOnForeignEdges: [],
      loopsCoveringNodes: [],
    })
  })
}
