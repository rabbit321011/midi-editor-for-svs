import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Project } from '@/types'
import { TOP_LEVEL_IDS, createEmptyProjectObjectTree } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useProjectStore } from './project'

const sample: Project = {
  id: 'fixture-project',
  name: 'Fixture',
  version: '1.0.0',
  objectTree: createEmptyProjectObjectTree(),
  tracks: {},
  trackOrder: [],
  segments: {},
  compGroups: {},
  compGroupOrder: [],
  timelineOffset: 0,
  pxPerSec: 60,
  f0Settings: { fmin: 65.4, fmax: 2093, algorithm: 'pyin', hopMs: 16 },
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
}

describe('self-contained project objectTree smoke test', () => {
  it('loads and serializes the project', () => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    const objectTree = useObjectTreeStore()

    project.load(sample)
    const json = project.toJSON()

    expect(objectTree.node(TOP_LEVEL_IDS.workspace)?.kind).toBe('folder')
    expect(objectTree.node(TOP_LEVEL_IDS.trackSources)?.kind).toBe('folder')
    expect(objectTree.node(TOP_LEVEL_IDS.tracks)?.kind).toBe('folder')
    expect(json.objectTree?.schemaVersion).toBe('object-workbench.v1')
    expect(() => JSON.stringify(json)).not.toThrow()
  })
})
