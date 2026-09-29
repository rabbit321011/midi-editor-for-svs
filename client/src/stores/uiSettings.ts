import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'

export type WorkbenchTheme = 'night' | 'light' | 'cream'

export interface WorkbenchPalette {
  surface: string
  panel: string
  elevated: string
  border: string
  text: string
  muted: string
  accent: string
  accentHover: string
  accentPressed: string
  hover: string
  selected: string
  located: string
  warning: string
  danger: string
  success: string
}

const STORAGE_KEY = 'aisvc-ui-settings.v0.32'
export interface UiSettingsState {
  theme: WorkbenchTheme
  showRomaji: boolean
  autoSaveIntervalMinutes: number
  svcDefaultModel: string
  svcDefaultSteps: number
  svcDefaultCfg: number
  svsDefaultModel: string
  svsDefaultSteps: number
  centerOpacity: number
  sideOpacity: number
  topbarOpacity: number
  backgroundImageEnabled: boolean
  backgroundImageUrl: string
  backgroundImageDataUrl: string
  sidebarGlassEnabled: boolean
  centerGlassEnabled: boolean
  sidebarWidth: number
  l1Width: number
  l1Collapsed: boolean
  l2Collapsed: boolean
}

const defaults: UiSettingsState = {
  theme: 'night',
  showRomaji: false,
  autoSaveIntervalMinutes: 5,
  svcDefaultModel: '',
  svcDefaultSteps: 100,
  svcDefaultCfg: 0.7,
  svsDefaultModel: '',
  svsDefaultSteps: 32,
  centerOpacity: 1,
  sideOpacity: 1,
  topbarOpacity: 1,
  backgroundImageEnabled: false,
  backgroundImageUrl: '',
  backgroundImageDataUrl: '',
  sidebarGlassEnabled: false,
  centerGlassEnabled: false,
  sidebarWidth: 360,
  l1Width: 230,
  l1Collapsed: false,
  l2Collapsed: false,
}

export const useUiSettingsStore = defineStore('uiSettings', () => {
  const settings = reactive<UiSettingsState>(loadSettings())
  const serverPreferenceState = ref<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const serverPreferenceError = ref('')
  let preferenceRequest = 0

  async function loadServerPreferences() {
    const request = ++preferenceRequest
    serverPreferenceState.value = 'loading'
    serverPreferenceError.value = ''
    try {
      const response = await fetch('/api/ui-preferences', { cache: 'no-store' })
      const value = await response.json()
      if (!response.ok || typeof value.showRomaji !== 'boolean') throw new Error(value.error || '显示设置读取失败')
      if (request !== preferenceRequest) return
      settings.showRomaji = value.showRomaji
      serverPreferenceState.value = 'ready'
    } catch (error: any) {
      if (request !== preferenceRequest) return
      serverPreferenceState.value = 'error'
      serverPreferenceError.value = error.message || '显示设置读取失败'
    }
  }

  async function setShowRomaji(value: boolean) {
    if (serverPreferenceState.value === 'saving') return false
    const request = ++preferenceRequest
    serverPreferenceState.value = 'saving'
    serverPreferenceError.value = ''
    try {
      const response = await fetch('/api/ui-preferences', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showRomaji: value }),
      })
      const result = await response.json()
      if (!response.ok || typeof result.showRomaji !== 'boolean') throw new Error(result.error || '显示设置保存失败')
      if (request !== preferenceRequest) return false
      settings.showRomaji = result.showRomaji
      serverPreferenceState.value = 'ready'
      return true
    } catch (error: any) {
      if (request === preferenceRequest) {
        serverPreferenceState.value = 'error'
        serverPreferenceError.value = error.message || '显示设置保存失败'
      }
      return false
    }
  }

  const rootClass = computed(() => `theme-${settings.theme}`)
  const palette = computed(() => workbenchPalette(settings.theme))
  const cssVars = computed(() => {
    const colors = palette.value
    return {
      '--app-surface': colors.surface,
      '--app-panel': colors.panel,
      '--app-elevated': colors.elevated,
      '--app-border': colors.border,
      '--app-text': colors.text,
      '--app-muted': colors.muted,
      '--app-accent': colors.accent,
      '--app-accent-hover': colors.accentHover,
      '--app-accent-pressed': colors.accentPressed,
      '--app-hover': colors.hover,
      '--app-selected': colors.selected,
      '--app-located': colors.located,
      '--app-warning': colors.warning,
      '--app-danger': colors.danger,
      '--app-success': colors.success,
      '--topbar-opacity': String(clamp01(settings.topbarOpacity)),
      '--side-opacity': String(clamp01(settings.sideOpacity)),
      '--center-opacity': String(clamp01(settings.centerOpacity)),
      '--topbar-opacity-percent': opacityPercent(settings.topbarOpacity),
      '--side-opacity-percent': opacityPercent(settings.sideOpacity),
      '--center-opacity-percent': opacityPercent(settings.centerOpacity),
      '--floating-opacity-percent': floatingOpacityPercent(),
      '--track-canvas-bg-alpha': String(clamp01(settings.centerOpacity)),
      '--sidebar-backdrop-filter': settings.sidebarGlassEnabled ? 'blur(14px) saturate(1.15)' : 'none',
      '--center-backdrop-filter': settings.centerGlassEnabled ? 'blur(14px) saturate(1.15)' : 'none',
      '--workbench-bg-image': settings.backgroundImageEnabled && settings.backgroundImageDataUrl
        ? `url("${settings.backgroundImageDataUrl}")`
        : settings.backgroundImageEnabled && settings.backgroundImageUrl
          ? `url("${settings.backgroundImageUrl}")`
        : 'none',
    }
  })

  watch(settings, () => persistSettings(settings), { deep: true })

  function update<K extends keyof UiSettingsState>(key: K, value: UiSettingsState[K]) {
    if (key === 'showRomaji') { void setShowRomaji(value === true); return true }
    ;(settings[key] as UiSettingsState[K]) = value
    normalize()
    return true
  }

  function setBackgroundImageUrl(url: string): { ok: boolean; reason?: string } {
    if (!url.trim()) return { ok: false, reason: '背景图片地址为空' }
    settings.backgroundImageUrl = url
    settings.backgroundImageDataUrl = ''
    settings.backgroundImageEnabled = true
    return { ok: true }
  }

  function setBackgroundImageDataUrl(dataUrl: string): { ok: boolean; reason?: string } {
    settings.backgroundImageDataUrl = dataUrl
    settings.backgroundImageUrl = ''
    settings.backgroundImageEnabled = true
    return { ok: true }
  }

  function clearBackgroundImage() {
    settings.backgroundImageUrl = ''
    settings.backgroundImageDataUrl = ''
    settings.backgroundImageEnabled = false
  }

  function reset() {
    const previousRomaji = settings.showRomaji
    Object.assign(settings, defaults)
    settings.showRomaji = previousRomaji
    void setShowRomaji(false)
  }

  function normalize() {
    settings.autoSaveIntervalMinutes = clampNumber(settings.autoSaveIntervalMinutes, 1, 120)
    settings.svcDefaultSteps = clampNumber(settings.svcDefaultSteps, 1, 200)
    settings.svcDefaultCfg = clampNumber(settings.svcDefaultCfg, 0, 10)
    settings.svsDefaultSteps = clampNumber(settings.svsDefaultSteps, 1, 200)
    settings.centerOpacity = clamp01(settings.centerOpacity)
    settings.sideOpacity = clamp01(settings.sideOpacity)
    settings.topbarOpacity = clamp01(settings.topbarOpacity)
    settings.sidebarWidth = clampNumber(settings.sidebarWidth, 240, 600)
    settings.l1Width = clampNumber(settings.l1Width, 140, settings.sidebarWidth - 100)
  }

  return {
    settings,
    rootClass,
    palette,
    cssVars,
    update,
    setBackgroundImageUrl,
    setBackgroundImageDataUrl,
    clearBackgroundImage,
    reset,
    loadServerPreferences,
    setShowRomaji,
    serverPreferenceState,
    serverPreferenceError,
  }
})

export function workbenchPalette(theme: WorkbenchTheme): WorkbenchPalette {
  if (theme === 'light') {
    return {
      surface: '#f4f6f8', panel: '#ffffff', elevated: '#ffffff', border: '#d7dde4',
      text: '#1f2328', muted: '#59636e', accent: '#0969da', accentHover: '#075dbf',
      accentPressed: '#064f9f', hover: '#e7edf3', selected: '#d8ebff', located: '#fff1bd',
      warning: '#9a6700', danger: '#cf222e', success: '#1a7f37',
    }
  }
  if (theme === 'cream') {
    return {
      surface: '#f6edcf', panel: '#fff8dc', elevated: '#fffdf2', border: '#d7c58f',
      text: '#2f2517', muted: '#75613c', accent: '#8a5a12', accentHover: '#744a0e',
      accentPressed: '#5e3b0b', hover: '#efe1b8', selected: '#ead49a', located: '#f1d68a',
      warning: '#8a5a12', danger: '#b4232c', success: '#397847',
    }
  }
  return {
    surface: '#0d1117', panel: '#161b22', elevated: '#1c232d', border: '#30363d',
    text: '#c9d1d9', muted: '#8b949e', accent: '#58a6ff', accentHover: '#79b8ff',
    accentPressed: '#388bfd', hover: '#21262d', selected: '#1f3a5f', located: '#3a2f14',
    warning: '#f0b72f', danger: '#f85149', success: '#3fb950',
  }
}

export function floatingOpacityPercent(): string {
  return '94%'
}

function opacityPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`
}

function loadSettings(): UiSettingsState {
  if (typeof localStorage === 'undefined') return { ...defaults }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaults }
    const parsed = JSON.parse(raw) as Partial<UiSettingsState>
    return { ...defaults, ...parsed, showRomaji: false }
  } catch {
    return { ...defaults }
  }
}

function persistSettings(settings: UiSettingsState) {
  if (typeof localStorage === 'undefined') return
  try {
    const { showRomaji: _serverPreference, ...localSettings } = settings
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localSettings))
  } catch {
    // Ignore storage quota errors; the in-memory settings still apply.
  }
}

function clamp01(value: number): number {
  return clampNumber(value, 0.2, 1)
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}
