import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiSettingsStore } from './uiSettings'

describe('ui settings store', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    setActivePinia(createPinia())
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
      removeItem: vi.fn((key: string) => { storage.delete(key) }),
      clear: vi.fn(() => { storage.clear() }),
    })
    localStorage.clear()
  })

  it('persists theme and opacity settings locally', async () => {
    const settings = useUiSettingsStore()

    settings.update('theme', 'cream')
    settings.update('centerOpacity', 0.55)
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem('aisvc-ui-settings.v0.32') || '{}')
    expect(stored.theme).toBe('cream')
    expect(stored.centerOpacity).toBe(0.55)
    expect(settings.rootClass).toBe('theme-cream')
    expect(settings.palette.accent).toBe('#8a5a12')
    expect(settings.cssVars['--app-panel']).toBe('#fff8dc')
    expect(settings.cssVars['--center-opacity-percent']).toBe('55%')
    expect(settings.cssVars['--floating-opacity-percent']).toBe('94%')
  })

  it('persists the resizable L1-first sidebar layout', async () => {
    const settings = useUiSettingsStore()

    settings.update('sidebarWidth', 420)
    settings.update('l1Width', 280)
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem('aisvc-ui-settings.v0.32') || '{}')
    expect(stored.sidebarWidth).toBe(420)
    expect(stored.l1Width).toBe(280)
  })

  it('stores backend background image urls instead of large local data urls', () => {
    const settings = useUiSettingsStore()
    const result = settings.setBackgroundImageUrl('/api/projects/demo/ui/background.png')

    expect(result.ok).toBe(true)
    expect(settings.settings.backgroundImageUrl).toBe('/api/projects/demo/ui/background.png')
    expect(settings.settings.backgroundImageDataUrl).toBe('')
    expect(settings.cssVars['--workbench-bg-image']).toBe('url("/api/projects/demo/ui/background.png")')

    settings.clearBackgroundImage()
    expect(settings.settings.backgroundImageUrl).toBe('')
    expect(settings.settings.backgroundImageEnabled).toBe(false)
  })

  it('ignores localStorage quota failures while keeping in-memory settings', async () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const settings = useUiSettingsStore()

    settings.update('theme', 'light')
    await Promise.resolve()

    expect(settings.settings.theme).toBe('light')
    spy.mockRestore()
  })

  it('loads romaji from the backend and excludes it from local preferences', async () => {
    localStorage.setItem('aisvc-ui-settings.v0.32', JSON.stringify({ showRomaji: true }))
    const settings = useUiSettingsStore()
    expect(settings.settings.showRomaji).toBe(false)
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ showRomaji: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await settings.loadServerPreferences()
    expect(settings.settings.showRomaji).toBe(true)
    expect(settings.serverPreferenceState).toBe('ready')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ showRomaji: false }) })
    expect(await settings.setShowRomaji(false)).toBe(true)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: '{"showRomaji":false}' })
    await Promise.resolve()
    expect(JSON.parse(localStorage.getItem('aisvc-ui-settings.v0.32') || '{}').showRomaji).toBeUndefined()
  })

  it('keeps the last saved preference when the backend rejects a change', async () => {
    const settings = useUiSettingsStore()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: '保存失败' }) }))
    expect(await settings.setShowRomaji(true)).toBe(false)
    expect(settings.settings.showRomaji).toBe(false)
    expect(settings.serverPreferenceError).toBe('保存失败')
  })
})
