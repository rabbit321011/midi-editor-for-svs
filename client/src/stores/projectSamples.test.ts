import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import synthesisProject from '../../../projects/想让你听见的是/project.json'
import type { Project } from '@/types'
import { TOP_LEVEL_IDS } from '@/object-workbench'
import { useObjectTreeStore } from './objectTree'
import { useProjectStore } from './project'

const samples = [
  ['想让你听见的是', synthesisProject],
] as const

describe('checked-in project samples objectTree migration smoke test', () => {
  it.each(samples)('loads %s and serializes objectTree', (_name, sample) => {
    setActivePinia(createPinia())
    const project = useProjectStore()
    const objectTree = useObjectTreeStore()

    project.load(sample as Project)
    const json = project.toJSON()

    expect(objectTree.node(TOP_LEVEL_IDS.workspace)?.kind).toBe('folder')
    expect(objectTree.node(TOP_LEVEL_IDS.trackSources)?.kind).toBe('folder')
    expect(objectTree.node(TOP_LEVEL_IDS.tracks)?.kind).toBe('folder')
    expect(json.objectTree?.schemaVersion).toBe('object-workbench.v1')
    expect(() => JSON.stringify(json)).not.toThrow()
  })
})
