export type DfmNodeType = 'FACT' | 'DIMENSION' | 'LEVEL' | 'DESCRIPTIVE'

export interface DfmNode {
  id: string
  label: string
  type: DfmNodeType
  optional: boolean
  details: string[]
}

export interface DfmEdge {
  source: string
  target: string
  connectionType: string
  optional: boolean
}

export interface DfmGraph {
  nodes: DfmNode[]
  edges: DfmEdge[]
}

export interface ParseError {
  message: string
  line?: number | null
  column?: number | null
}
