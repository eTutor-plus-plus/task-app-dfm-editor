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
// Longest edge in most fixtures is about 310 units (wide fans, labelled fact connections); this guards
// against the layout getting looser.
const maximumEdgeLength = 360
// professorEmployeeNo has ten children; the edges to the outermost of them span half of that wide fan.
const maximumEdgeLengthByScenario: Record<string, number> = { 'modell-7-thesis': 400 }
// Known layout problems: the test is expected to fail and starts failing once the problem is fixed.
const knownLayoutProblems: Record<string, string> = {}
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

async function expectCleanLayout(graph: Locator, minimumScale = minimumReadableScale, maximumLength = maximumEdgeLength) {
  const layout = await graph.evaluate(inspectGraphLayout)
  expect({
    nodesWithInvalidPosition: layout.nodesWithInvalidPosition,
    overlappingNodes: layout.overlappingNodes,
    edgesCrossingNodes: layout.edgesCrossingNodes,
    crossingEdges: layout.crossingEdges,
    nodesOutsideViewport: layout.nodesOutsideViewport,
    labelsCoveredByNodes: layout.labelsCoveredByNodes,
    overlappingLabels: layout.overlappingLabels,
    labelsOnForeignEdges: layout.labelsOnForeignEdges,
    loopsCoveringNodes: layout.loopsCoveringNodes,
  }).toEqual({
    nodesWithInvalidPosition: [],
    overlappingNodes: [],
    edgesCrossingNodes: [],
    crossingEdges: [],
    nodesOutsideViewport: [],
    labelsCoveredByNodes: [],
    overlappingLabels: [],
    labelsOnForeignEdges: [],
    loopsCoveringNodes: [],
  })
  expect(layout.longestEdge, 'edges must not become so long that hierarchies fall apart')
    .toBeLessThanOrEqual(maximumLength)
  expect(layout.scale, 'graph must stay readable (labels not shrunk too far)')
    .toBeGreaterThanOrEqual(minimumScale)
}

async function expectGraphMatches(graph: Locator, expected: DfmGraph) {
  const count = (predicate: (node: DfmGraph['nodes'][number]) => boolean) =>
    expected.nodes.filter(predicate).length
  // Recursive and parallel edges use paths; multiple non-recursive connections use two paths or lines.
  const loops = expected.edges.filter((edge) => edge.source === edge.target)
  const nonLoops = expected.edges.filter((edge) => edge.source !== edge.target)
  const parallelEdges = nonLoops.filter((edge) =>
    nonLoops.filter((other) => other.source === edge.source && other.target === edge.target).length > 1)
  const lineEdges = nonLoops.filter((edge) => !parallelEdges.includes(edge))
  const convergenceEdges = expected.edges.filter((edge) => edge.connectionType === 'CONVERGENCE').length
  const doubleLineEdges = lineEdges.filter((edge) =>
    edge.connectionType === 'CONVERGENCE' || edge.connectionType === 'MULTIPLE').length

  await expect(graph.locator('.graph-node')).toHaveCount(expected.nodes.length)
  await expect(graph.locator('.graph-node.fact')).toHaveCount(count((node) => node.type === 'FACT'))
  await expect(graph.locator('.graph-node.level')).toHaveCount(count((node) => node.type === 'LEVEL'))
  await expect(graph.locator('.graph-node.descriptive'))
    .toHaveCount(count((node) => node.type === 'DESCRIPTIVE'))
  await expect(graph.locator('.graph-node.optional')).toHaveCount(count((node) => node.optional))
  await expect(graph.locator('.edge-group')).toHaveCount(expected.edges.length)
  await expect(graph.locator('line.edge')).toHaveCount(lineEdges.length + doubleLineEdges)
  await expect(graph.locator('path.edge')).toHaveCount(loops.length + parallelEdges.length
    + parallelEdges.filter((edge) => edge.connectionType === 'MULTIPLE' || edge.connectionType === 'CONVERGENCE').length)
  await expect(graph.locator('line.optional-edge-marker'))
    .toHaveCount(expected.edges.filter((edge) => edge.optional).length)
  await expect(graph.locator('.edge[marker-end="url(#convergence-arrow)"]')).toHaveCount(convergenceEdges)

  for (const label of new Set(expected.nodes.flatMap((node) => [node.label, ...node.details]))) {
    await expect(graph.getByText(label, { exact: true }).first()).toBeAttached()
  }
}

test('places convergence arrows at the target border for straight, parallel, and recursive edges', async ({ page }) => {
  const scenario = scenarios.find((item) => item.name === 'convergence-two-targets')!
  const model = structuredClone(scenario.graph)
  const convergence = model.edges.find((edge) => edge.connectionType === 'CONVERGENCE')!
  model.nodes.find((node) => node.id === convergence.target)!.type = 'SHARED'
  model.edges.push({ ...convergence, optional: true, label: 'alternative' })
  const recursiveTarget = model.nodes.find((node) => node.label === 'fiscalYear')!
  model.edges.push({ ...convergence, source: recursiveTarget.id, target: recursiveTarget.id, label: 'parent' })
  await mockParseApi(page, model)
  const graph = await renderModel(page, scenario.dfm)
  await expectGraphMatches(graph, model)

  const arrows = await graph.evaluate((svg, expected) => {
    const groups = Array.from(svg.querySelectorAll<SVGGElement>('.edge-group'))
    const nodes = Array.from(svg.querySelectorAll<SVGGElement>('.graph-node'))
    return expected.edges.flatMap((edge, index) => {
      if (edge.connectionType !== 'CONVERGENCE') return []
      const target = nodes[expected.nodes.findIndex((node) => node.id === edge.target)]
      const matrix = target.transform.baseVal.consolidate()!.matrix
      const circle = target.querySelector<SVGCircleElement>('.shared-ring, circle')!
      const radius = circle.r.baseVal.value
      const group = groups[index]
      const segments = Array.from(group.querySelectorAll<SVGGeometryElement>('.edge'))
      const arrow = group.querySelector<SVGGeometryElement>('.edge[marker-end]')
      if (!arrow) return [{ error: Infinity, arrowOnLastSegment: false, curved: false, optional: edge.optional, loop: false }]
      const point = arrow instanceof SVGPathElement
        ? arrow.getPointAtLength(arrow.getTotalLength())
        : new DOMPoint(Number(arrow.getAttribute('x2')), Number(arrow.getAttribute('y2')))
      return [{
        error: Math.abs(Math.hypot(point.x - matrix.e, point.y - matrix.f) - radius),
        arrowOnLastSegment: arrow === segments[segments.length - 1],
        curved: arrow instanceof SVGPathElement,
        optional: edge.optional,
        loop: edge.source === edge.target,
      }]
    })
  }, model)

  expect(arrows.some((arrow) => arrow.curved && arrow.optional)).toBe(true)
  expect(arrows.some((arrow) => !arrow.curved)).toBe(true)
  expect(arrows.some((arrow) => arrow.loop)).toBe(true)
  for (const arrow of arrows) {
    expect(arrow.arrowOnLastSegment).toBe(true)
    expect(arrow.error).toBeLessThan(0.01)
  }
  await expect(graph.locator('#convergence-arrow')).toHaveAttribute('refX', '10')
})

test('places a recursive shared hierarchy arrow at the outer ring', async ({ page }) => {
  const scenario = scenarios.find((item) => item.name === 'recursive-shared-hierarchy')!
  await mockParseApi(page, scenario.graph)
  const graph = await renderModel(page, scenario.dfm)
  await expectGraphMatches(graph, scenario.graph)

  const loop = graph.locator('.loop-edge')
  await expect(loop).toHaveAttribute('marker-end', 'url(#convergence-arrow)')
  const distances = await loop.evaluate((path: SVGPathElement) => {
    const node = path.closest('.graph-content')!.querySelector<SVGGElement>('.graph-node.shared')!
    const matrix = node.transform.baseVal.consolidate()!.matrix
    const radius = node.querySelector<SVGCircleElement>('.shared-ring')!.r.baseVal.value
    return [path.getPointAtLength(0), path.getPointAtLength(path.getTotalLength())]
      .map((point) => Math.abs(Math.hypot(point.x - matrix.e, point.y - matrix.f) - radius))
  })
  expect(distances[0]).toBeLessThan(0.01)
  expect(distances[1]).toBeLessThan(0.01)
})

test('centers a semicircular cross arc on a single incoming edge', async ({ page }) => {
  const model: DfmGraph = {
    nodes: [
      { id: 'a', label: 'Sales', type: 'FACT', optional: false, details: [] },
      { id: 'x', label: 'VAT', type: 'CROSS', optional: false, details: [] },
      { id: 'z', label: 'Rate', type: 'LEVEL', optional: false, details: [] },
    ],
    edges: [
      { source: 'a', target: 'x', connectionType: 'SIMPLE', optional: false },
      { source: 'x', target: 'z', connectionType: 'SIMPLE', optional: false },
    ],
  }
  await mockParseApi(page, model)
  const graph = await renderModel(page, 'fact Sales;')
  await expectGraphMatches(graph, model)

  const result = await graph.evaluate((svg) => {
    const node = svg.querySelector<SVGGElement>('.graph-node.cross')!
    const matrix = node.transform.baseVal.consolidate()!.matrix
    const arc = node.querySelector<SVGPathElement>('.cross-arc')!
    const length = arc.getTotalLength()
    const middle = arc.getPointAtLength(length / 2)
    const line = svg.querySelector<SVGLineElement>('.edge-group line.edge')!
    const source = line.getPointAtLength(0)
    const dx = source.x - matrix.e, dy = source.y - matrix.f
    return {
      length,
      alignment: (middle.x * dx + middle.y * dy) / (Math.hypot(middle.x, middle.y) * Math.hypot(dx, dy)),
      labelTop: node.querySelector<SVGTextElement>('.node-label')!.getBBox().y,
    }
  })

  expect(result.length).toBeCloseTo(14 * Math.PI, 1)
  expect(result.alignment).toBeGreaterThan(0.999)
  expect(result.labelTop).toBeGreaterThan(14)
})

test('aligns the cross arc with every incoming edge and extends it when needed', async ({ page }) => {
  const model: DfmGraph = {
    nodes: [
      { id: 'a', label: 'Sales', type: 'FACT', optional: false, details: [] },
      { id: 'b', label: 'Budget', type: 'FACT', optional: false, details: [] },
      { id: 'x', label: 'VAT', type: 'CROSS', optional: false, details: [] },
      { id: 'z', label: 'Rate', type: 'LEVEL', optional: false, details: [] },
    ],
    edges: [
      { source: 'a', target: 'x', connectionType: 'CONVERGENCE', optional: false },
      { source: 'a', target: 'x', connectionType: 'SIMPLE', optional: true },
      { source: 'b', target: 'x', connectionType: 'MULTIPLE', optional: false },
      { source: 'x', target: 'x', connectionType: 'CONVERGENCE', optional: false, label: 'parent' },
      { source: 'x', target: 'z', connectionType: 'SIMPLE', optional: false },
    ],
  }
  await mockParseApi(page, model)
  const graph = await renderModel(page, 'fact Sales;')
  await expectGraphMatches(graph, model)

  const result = await graph.evaluate((svg, expected) => {
    const node = svg.querySelector<SVGGElement>('.graph-node.cross')!
    const matrix = node.transform.baseVal.consolidate()!.matrix
    const arc = node.querySelector<SVGPathElement>('.cross-arc')!
    const arcLength = arc.getTotalLength()
    const groups = Array.from(svg.querySelectorAll<SVGGElement>('.edge-group'))
    const results = expected.edges.flatMap((edge, index) => {
      if (edge.target !== 'x') return []
      const segments = Array.from(groups[index].querySelectorAll<SVGGeometryElement>('.edge'))
      const lines = edge.connectionType === 'MULTIPLE' ? segments.map((segment) => [segment]) : [segments]
      return lines.map((line) => {
        const last = line[line.length - 1]
        const end = last.getPointAtLength(last.getTotalLength())
        const endDistance = Math.hypot(end.x - matrix.e, end.y - matrix.f)
        for (const segment of [...line].reverse()) {
          const length = segment.getTotalLength()
          for (let position = length; position >= 0; position -= 0.2) {
            const point = segment.getPointAtLength(position)
            const distance = Math.hypot(point.x - matrix.e, point.y - matrix.f)
            if (Math.abs(distance - 14) > 0.11) continue
            let nearest = Infinity
            for (let i = 0; i <= 2000; i += 1) {
              const arcPoint = arc.getPointAtLength(arcLength * i / 2000)
              nearest = Math.min(nearest, Math.hypot(point.x - matrix.e - arcPoint.x, point.y - matrix.f - arcPoint.y))
            }
            return { endDistance, arcDistance: nearest }
          }
        }
        return { endDistance, arcDistance: Infinity }
      })
    })
    return { arcLength, results }
  }, model)

  expect(result.results).toHaveLength(5)
  expect(result.arcLength).toBeGreaterThan(14 * Math.PI + 1)
  expect(result.arcLength).toBeLessThanOrEqual(14 * Math.PI * 2 + 0.1)
  for (const edge of result.results) {
    expect(edge.endDistance).toBeLessThanOrEqual(10.01)
    expect(edge.arcDistance).toBeLessThan(0.15)
  }
})

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

test('copies the current DFM source to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.clock.install()
  await page.goto('/')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)

  const source = 'fact Umsatz {\n  Betrag;\n};\n'
  await page.locator('.cm-content').fill(source)
  const copyButton = page.getByRole('button', { name: 'DFM-Quelltext in die Zwischenablage kopieren' })
  const feedback = page.locator('.source-editor-container').getByRole('status')
  await expect(copyButton).toHaveAttribute('title', 'DFM-Quelltext in die Zwischenablage kopieren')
  await expect(copyButton).toHaveText('')
  await copyButton.click()
  await expect(feedback).toHaveText('DFM-Quelltext in die Zwischenablage kopiert.')
  await expect(copyButton.locator('.copy-success-icon')).toBeVisible()
  await expect(copyButton).toHaveCSS('color', 'rgb(2, 122, 72)')
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(source)
  await page.clock.fastForward(499)
  await expect(copyButton.locator('.copy-success-icon')).toBeVisible()
  await page.clock.fastForward(1)
  await expect(copyButton.locator('.copy-default-icon')).toBeVisible()
  await expect(feedback).toHaveText('')

  await page.locator('.cm-content').fill('')
  await expect(copyButton).toBeDisabled()
  await expect(feedback).toHaveText('')
})

test('shows localized feedback when copying the DFM source fails', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('Clipboard access denied')) },
    })
  })

  await page.getByRole('button', { name: 'Sprache auf Englisch umstellen' }).click()
  const copyButton = page.getByRole('button', { name: 'Copy DFM source to clipboard' })
  const feedback = page.locator('.source-editor-container').getByRole('status')
  await expect(copyButton).toHaveAttribute('title', 'Copy DFM source to clipboard')
  await copyButton.click()
  await expect(feedback).toHaveText('Could not copy DFM source. Check your browser permissions.')
  await expect(copyButton.locator('.copy-error-icon')).toBeVisible()
  await expect(copyButton).toHaveCSS('color', 'rgb(180, 35, 24)')
  await page.clock.fastForward(499)
  await expect(copyButton.locator('.copy-error-icon')).toBeVisible()
  await page.clock.fastForward(1)
  await expect(copyButton.locator('.copy-default-icon')).toBeVisible()
  await expect(feedback).toHaveText('')
})

test('restarts copy feedback on repeated clicks and clears it when the source changes', async ({ page }) => {
  await page.clock.install()
  await page.goto('/')
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000)
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    })
  })

  const copyButton = page.getByRole('button', { name: 'DFM-Quelltext in die Zwischenablage kopieren' })
  await copyButton.click()
  await expect(copyButton.locator('.copy-success-icon')).toBeVisible()
  await page.clock.fastForward(250)
  await copyButton.click()
  await page.clock.fastForward(250)
  await expect(copyButton.locator('.copy-success-icon')).toBeVisible()
  await page.clock.fastForward(250)
  await expect(copyButton.locator('.copy-default-icon')).toBeVisible()

  await copyButton.click()
  await expect(copyButton.locator('.copy-success-icon')).toBeVisible()
  await page.locator('.cm-content').fill('fact Changed;')
  await expect(copyButton.locator('.copy-default-icon')).toBeVisible()
  await expect(page.locator('.source-editor-container').getByRole('status')).toHaveText('')
})

test('shows the editor and graph without a notes area', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'DFM-Notation' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'DFM Model' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Notizen zum Modell' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sprache auf Englisch umstellen' }).click()
  await expect(page.getByRole('textbox', { name: 'Model notes' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Copy DFM source to clipboard' })).toBeVisible()
})

for (const scenario of scenarios) {
  test(`renders "${scenario.name}"`, async ({ page }) => {
    const requests = await mockParseApi(page, scenario.graph)
    const graph = await renderModel(page, scenario.dfm)

    await expectGraphMatches(graph, scenario.graph)
    await expect(page.getByText(scenario.graph.nodes.length === 1
      ? '1 Element'
      : `${scenario.graph.nodes.length} Elemente`)).toBeVisible()
    const minimumScale = minimumScaleByScenario[scenario.name] ?? minimumReadableScale
    const maximumLength = maximumEdgeLengthByScenario[scenario.name] ?? maximumEdgeLength
    if (!(scenario.name in knownLayoutProblems)) await expectCleanLayout(graph, minimumScale, maximumLength)
    expect(requests.map((request) => request.trim())).toEqual([scenario.dfm.trim()])

    await page.getByRole('button', { name: 'Vergrößern' }).click()
    await page.getByRole('button', { name: 'Zoom zurücksetzen' }).click()
    if (!(scenario.name in knownLayoutProblems)) await expectCleanLayout(graph, minimumScale, maximumLength)
  })
  if (scenario.name in knownLayoutProblems) {
    test(`lays out "${scenario.name}" without the known problem`, async ({ page }) => {
      test.fail(true, knownLayoutProblems[scenario.name])
      await mockParseApi(page, scenario.graph)
      const graph = await renderModel(page, scenario.dfm)
      await expectCleanLayout(graph,
        minimumScaleByScenario[scenario.name] ?? minimumReadableScale,
        maximumEdgeLengthByScenario[scenario.name] ?? maximumEdgeLength)
    })
  }
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

test('formats shared and cross levels like descriptive levels', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill(
    'hierarchy city{city - country - {cross} VAT;city = region;};dimension customer{customer -[customerCity]- {shared} city;};')
  await page.getByRole('button', { name: 'Formatieren' }).click()

  const lines = await page.locator('.cm-line').allInnerTexts()
  expect(lines.join('\n').trim()).toBe([
    'hierarchy city {',
    '  city - country - {cross} VAT;',
    '  city = region;',
    '};',
    'dimension customer {',
    '  customer -[customerCity]- {shared} city;',
    '};',
  ].join('\n'))
})

test('preserves optional and multiple fact connections when formatting', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('fact F{m;};dimension D{d;};F(-[shipping]-)D;F=[billing]=D;')
  await page.getByRole('button', { name: 'Formatieren' }).click()
  const formatted = (await page.locator('.cm-line').allInnerTexts()).join('\n')
  expect(formatted).toContain('F ( -[shipping]-) D;')
  expect(formatted).toContain('F =[billing]= D;')
})

test('folds and unfolds an indented block via the gutter arrow', async ({ page }) => {
  await page.goto('/')
  await page.locator('.cm-content').fill('fact F{m1;m2;};dimension D{d;};F-D;')
  await page.getByRole('button', { name: 'Formatieren' }).click()
  await expect(page.locator('.cm-line', { hasText: 'm1;' })).toBeVisible()

  await page.locator('.cm-foldGutter span[title="Fold line"]').first().click()
  await expect(page.locator('.cm-line', { hasText: 'm1;' })).toHaveCount(0)
  await expect(page.locator('.cm-line', { hasText: 'm2;' })).toHaveCount(0)
  await expect(page.locator('.cm-line', { hasText: 'dimension D' })).toBeVisible()

  await page.locator('.cm-foldGutter span[title="Unfold line"]:visible').click()
  await expect(page.locator('.cm-line', { hasText: 'm1;' })).toBeVisible()
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

test('rejects a multiple recursive connection returned by an older backend', async ({ page }) => {
  const graph: DfmGraph = {
    nodes: [{ id: 'worker', label: 'worker', type: 'LEVEL', optional: false, details: [] }],
    edges: [{ source: 'worker', target: 'worker', connectionType: 'MULTIPLE', optional: true, label: 'role' }],
  }
  await mockParseApi(page, graph)
  const diagram = await renderModel(page, 'dimension D { worker (=[role]=) worker; };')
  await expect(page.getByRole('alert')).toContainText('Das Backend hat ein ungültiges Graph-Modell zurückgegeben.')
  await expect(diagram.locator('.graph-node')).toHaveCount(0)
})

test('keeps the label of a fact connection clear of the fact box', async ({ page }) => {
  const scenario = scenarios.find((item) => item.name === 'labelled-fact-connection')!
  await mockParseApi(page, scenario.graph)
  const graph = await renderModel(page, scenario.dfm)
  await expect(graph.locator('.graph-node')).toHaveCount(scenario.graph.nodes.length)

  const overlap = await graph.evaluate((svg) => {
    const fact = svg.querySelector('.graph-node.fact')!.getBoundingClientRect()
    return [...svg.querySelectorAll('text.edge-label')].map((text) => {
      const box = text.getBoundingClientRect()
      return {
        label: text.textContent,
        overlaps: box.left < fact.right && box.right > fact.left && box.top < fact.bottom && box.bottom > fact.top,
      }
    }).filter((entry) => entry.overlaps)
  })
  expect(overlap).toEqual([])
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
