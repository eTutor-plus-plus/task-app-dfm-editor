import { expect, test, type Locator, type Page } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DfmGraph } from '../src/types'
import { inspectGraphLayout } from './layout'

// Fixtures contain the DFM source and the graph produced by the real backend parser.
const fixtureDirectory = join(process.cwd(), 'e2e', 'fixtures')
const scenarios = readdirSync(fixtureDirectory)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .map((name) => ({
    name,
    dfm: readFileSync(join(fixtureDirectory, `${name}.dfm`), 'utf8').replace(/\r\n/g, '\n'),
    graph: JSON.parse(readFileSync(join(fixtureDirectory, `${name}.json`), 'utf8')) as DfmGraph,
  }))

const minimumReadableScale = 0.4
// The canvas has a fixed size, so very large models are fitted smaller and are meant to be read by zooming in.
const minimumScaleByScenario: Record<string, number> = { 'large-model': 0.25 }
const backendUrl = process.env.E2E_BACKEND_URL ?? 'http://localhost:8082'

async function renderModel(page: Page, dfm: string) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'DFM Editor' })).toBeVisible()
  await page.locator('.cm-content').fill(dfm)
  await page.getByRole('button', { name: 'Ausführen' }).click()
  return page.getByRole('img', { name: 'DFM-Attributbaum' })
}

async function mockParseApi(page: Page, graph: DfmGraph) {
  const requests: string[] = []
  await page.route('**/api/dfm/parse', async (route) => {
    requests.push(route.request().postData() ?? '')
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(graph),
    })
  })
  return requests
}

async function expectCleanLayout(graph: Locator, minimumScale = minimumReadableScale) {
  const layout = await graph.evaluate(inspectGraphLayout)
  expect({
    nodesWithInvalidPosition: layout.nodesWithInvalidPosition,
    overlappingNodes: layout.overlappingNodes,
    edgesCrossingNodes: layout.edgesCrossingNodes,
    crossingEdges: layout.crossingEdges,
    nodesOutsideViewport: layout.nodesOutsideViewport,
  }).toEqual({
    nodesWithInvalidPosition: [],
    overlappingNodes: [],
    edgesCrossingNodes: [],
    crossingEdges: [],
    nodesOutsideViewport: [],
  })
  expect(layout.scale, 'graph must stay readable (labels not shrunk too far)')
    .toBeGreaterThanOrEqual(minimumScale)
}

async function expectGraphMatches(graph: Locator, expected: DfmGraph) {
  const count = (predicate: (node: DfmGraph['nodes'][number]) => boolean) =>
    expected.nodes.filter(predicate).length
  const convergenceEdges = expected.edges.filter((edge) => edge.connectionType === 'CONVERGENCE').length
  const doubleLineEdges = expected.edges.filter((edge) =>
    edge.connectionType === 'CONVERGENCE' || edge.connectionType === 'MULTIPLE').length

  await expect(graph.locator('.graph-node')).toHaveCount(expected.nodes.length)
  await expect(graph.locator('.graph-node.fact')).toHaveCount(count((node) => node.type === 'FACT'))
  await expect(graph.locator('.graph-node.level')).toHaveCount(count((node) => node.type === 'LEVEL'))
  await expect(graph.locator('.graph-node.descriptive'))
    .toHaveCount(count((node) => node.type === 'DESCRIPTIVE'))
  await expect(graph.locator('.graph-node.optional')).toHaveCount(count((node) => node.optional))
  await expect(graph.locator('.edge-group')).toHaveCount(expected.edges.length)
  await expect(graph.locator('line.edge')).toHaveCount(expected.edges.length + doubleLineEdges)
  await expect(graph.locator('line.optional-edge-marker'))
    .toHaveCount(expected.edges.filter((edge) => edge.optional).length)
  await expect(graph.locator('line[marker-end="url(#convergence-arrow)"]')).toHaveCount(convergenceEdges)

  for (const label of new Set(expected.nodes.flatMap((node) => [node.label, ...node.details]))) {
    await expect(graph.getByText(label, { exact: true }).first()).toBeAttached()
  }
}

test('exports a PNG using a localized download icon', async ({ page }) => {
  const purchase = scenarios.find((scenario) => scenario.name === 'purchase')!
  await mockParseApi(page, purchase.graph)
  await page.goto('/')

  const exportButton = page.getByRole('button', { name: 'PNG exportieren' })
  await expect(exportButton).toBeDisabled()
  await expect(exportButton).toHaveAttribute('title', 'PNG exportieren')
  await expect(exportButton).toHaveText('')
  await expect(exportButton.locator('svg')).toHaveCSS('min-height', '0px')

  await page.getByRole('button', { name: 'Ausführen' }).click()
  await expect(exportButton).toBeEnabled()
  await page.getByRole('button', { name: 'Sprache auf Englisch umstellen' }).click()
  const englishExportButton = page.getByRole('button', { name: 'Export PNG' })
  await expect(englishExportButton).toHaveAttribute('title', 'Export PNG')

  const downloadPromise = page.waitForEvent('download')
  await englishExportButton.click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^dfm-visualisierung-\d{4}-\d{2}-\d{2}\.png$/)
  expect(readFileSync(await download.path()).subarray(0, 8))
    .toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
})

for (const scenario of scenarios) {
  test(`renders "${scenario.name}" readable and without overlaps`, async ({ page }) => {
    const requests = await mockParseApi(page, scenario.graph)
    const graph = await renderModel(page, scenario.dfm)

    await expectGraphMatches(graph, scenario.graph)
    await expect(page.getByText(scenario.graph.nodes.length === 1
      ? '1 Element'
      : `${scenario.graph.nodes.length} Elemente`)).toBeVisible()
    const minimumScale = minimumScaleByScenario[scenario.name] ?? minimumReadableScale
    await expectCleanLayout(graph, minimumScale)
    expect(requests.map((request) => request.trim())).toEqual([scenario.dfm.trim()])

    await page.getByRole('button', { name: 'Vergrößern' }).click()
    await page.getByRole('button', { name: 'Zoom zurücksetzen' }).click()
    await expectCleanLayout(graph, minimumScale)
  })
}

test('keeps the layout stable when the same model is rendered twice', async ({ page }) => {
  const purchase = scenarios.find((scenario) => scenario.name === 'purchase')!
  await mockParseApi(page, purchase.graph)
  const graph = await renderModel(page, purchase.dfm)
  await expectGraphMatches(graph, purchase.graph)
  const first = await graph.evaluate(inspectGraphLayout)

  await page.getByRole('button', { name: 'Ausführen' }).click()
  await expectGraphMatches(graph, purchase.graph)
  expect(await graph.evaluate(inspectGraphLayout)).toEqual(first)
})

test('replaces a rendered graph when a smaller model is run', async ({ page }) => {
  const large = scenarios.find((scenario) => scenario.name === 'purchase')!
  const small = scenarios.find((scenario) => scenario.name === 'long-labels')!
  let current = large.graph
  await page.route('**/api/dfm/parse', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current),
    })
  })

  const graph = await renderModel(page, large.dfm)
  await expectGraphMatches(graph, large.graph)

  current = small.graph
  await page.locator('.cm-content').fill(small.dfm)
  await page.getByRole('button', { name: 'Ausführen' }).click()
  await expectGraphMatches(graph, small.graph)
  await expectCleanLayout(graph)
})

test('shows parse errors returned by the backend and clears the graph', async ({ page }) => {
  const purchase = scenarios.find((scenario) => scenario.name === 'purchase')!
  let respondWithError = false
  await page.route('**/api/dfm/parse', async (route) => {
    await route.fulfill(respondWithError
      ? {
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Syntaxfehler', line: 1, column: 12 }),
      }
      : {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(purchase.graph),
      })
  })

  const graph = await renderModel(page, purchase.dfm)
  await expect(graph.locator('.graph-node')).toHaveCount(purchase.graph.nodes.length)

  respondWithError = true
  await page.locator('.cm-content').fill('fact Broken {')
  await page.getByRole('button', { name: 'Ausführen' }).click()

  const alert = page.getByRole('alert')
  await expect(alert).toContainText('Syntaxfehler')
  await expect(alert).toContainText('Zeile 1, Spalte 12')
  await expect(graph.locator('.graph-node')).toHaveCount(0)
})

test.describe('with the real backend', () => {
  test.skip(!process.env.E2E_BACKEND, `Set E2E_BACKEND=1 with a backend running at ${backendUrl}`)

  for (const scenario of scenarios) {
    test(`parser output for "${scenario.name}" matches the fixture`, async ({ request }) => {
      const response = await request.post(`${backendUrl}/api/dfm/parse`, {
        headers: { 'Content-Type': 'text/plain' },
        data: scenario.dfm,
      })
      expect(response.ok()).toBe(true)
      expect(await response.json()).toEqual(scenario.graph)
    })
  }

  test('renders the Purchase model end to end through the dev proxy', async ({ page }) => {
    const purchase = scenarios.find((scenario) => scenario.name === 'purchase')!
    const graph = await renderModel(page, purchase.dfm)

    await expectGraphMatches(graph, purchase.graph)
    await expectCleanLayout(graph)
  })
})
