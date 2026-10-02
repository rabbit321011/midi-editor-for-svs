import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { isMidiInstrument, type MidiInstrument } from '@/utils/midiInstrument'

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
  midiInstrument: MidiInstrument
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
  midiInstrument: 'soft',
  autoSaveIntervalMinutes: 5,
  svcDefaultModel: '',
  svcDefaultSteps: 100,
  svcDefaultCfg: 0.7,
  svsDefaultModel: '',
  svsDefaultSteps: 32,
  centerOpacity: 0.95,
  sideOpacity: 0.92,
  topbarOpacity: 0.95,
  backgroundImageEnabled: false,
  backgroundImageUrl: '',
  backgroundImageDataUrl: '',
  sidebarGlassEnabled: true,
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
    const theme = settings.theme
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
      // Synthesis editor specific colors - 每个组件保持独特颜色以便区分
      '--synth-surface': colors.surface,
      '--synth-panel': colors.panel,
      '--synth-floating': colors.elevated,
      '--synth-grid-line': theme === 'night' ? '#1e293b' : theme === 'cream' ? '#d7c58f' : '#d7dde4',
      '--synth-grid-major': theme === 'night' ? '#334155' : theme === 'cream' ? '#b8a872' : '#b0b8c0',
      // Segment - 蓝色系（文本段落）
      '--synth-segment-bg': theme === 'night' ? '#1d3545' : theme === 'cream' ? '#e5dccf' : '#e0f0ff',
      '--synth-segment-border': theme === 'night' ? '#4b83a6' : theme === 'cream' ? '#8a7a5d' : '#5ba3d0',
      '--synth-segment-text': theme === 'night' ? '#eef6fb' : theme === 'cream' ? '#3d3d2d' : '#0d3d5d',
      '--synth-segment-muted': theme === 'night' ? '#9ab0bf' : theme === 'cream' ? '#8a7a5d' : '#6b7d8e',
      '--synth-segment-status': theme === 'night' ? '#a0dfc3' : theme === 'cream' ? '#6b9d7e' : '#4a9d7e',
      // Kana - 紫色系（假名控制）
      '--synth-kana-bg': theme === 'night' ? '#322746' : theme === 'cream' ? '#e8dff0' : '#f0e6ff',
      '--synth-kana-border': theme === 'night' ? '#8f72b8' : theme === 'cream' ? '#7d5a9d' : '#9a6fab',
      '--synth-kana-text': theme === 'night' ? '#f3ebfb' : theme === 'cream' ? '#3d2d4d' : '#4d2d6d',
      '--synth-kana-muted': theme === 'night' ? '#b8a9cc' : theme === 'cream' ? '#8a7a9d' : '#7d6a9d',
      '--synth-kana-boundary': theme === 'night' ? '#c3a2eb' : theme === 'cream' ? '#9d7dcb' : '#b88ee5',
      // Kana segment - 黄色系（假名分段）
      '--synth-kana-seg-bg': theme === 'night' ? '#51401f' : theme === 'cream' ? '#f4ead8' : '#fff8e0',
      '--synth-kana-seg-border': theme === 'night' ? '#d2a85b' : theme === 'cream' ? '#b8925d' : '#c9a84d',
      '--synth-kana-seg-text': theme === 'night' ? '#f4d88e' : theme === 'cream' ? '#6d5a2d' : '#7d6a3d',
      // H-token - 粉色系（音素令牌）
      '--synth-h-bg': theme === 'night' ? '#482634' : theme === 'cream' ? '#f4e0e8' : '#ffe5f0',
      '--synth-h-border': theme === 'night' ? '#d0778f' : theme === 'cream' ? '#b8607d' : '#d5708f',
      '--synth-h-text': theme === 'night' ? '#ffd3de' : theme === 'cream' ? '#8a2d45' : '#a03d55',
      // H-token special - 黄色系（特殊音素）
      '--synth-h-special-bg': theme === 'night' ? '#45391f' : theme === 'cream' ? '#f4ead8' : '#fff8e0',
      '--synth-h-special-border': theme === 'night' ? '#d2a85b' : theme === 'cream' ? '#b8925d' : '#c9a84d',
      '--synth-h-special-text': theme === 'night' ? '#f4d48c' : theme === 'cream' ? '#6d5a2d' : '#7d6a3d',
      // MIDI - 各种音符类型用不同颜色
      '--synth-midi-note': theme === 'night' ? '#4a91ad' : theme === 'cream' ? '#6b8a9d' : '#5ba3d0',
      '--synth-midi-flow': theme === 'night' ? '#9a6fab' : theme === 'cream' ? '#9d7dcb' : '#b88ee5',
      '--synth-midi-rest': theme === 'night' ? '#4c5662' : theme === 'cream' ? '#b8a89d' : '#9da8b8',
      '--synth-midi-pad': theme === 'night' ? '#8e5665' : theme === 'cream' ? '#c8909d' : '#d57d8f',
      // 通用
      '--synth-selected': theme === 'night' ? '#f0c45c' : theme === 'cream' ? '#d4b85c' : '#e0b84d',
      '--synth-boundary': theme === 'night' ? '#79b3d5' : theme === 'cream' ? '#6b95b8' : '#5ba3d0',
      '--synth-actions-bg': theme === 'night' ? 'rgba(14, 26, 35, 0.72)' : theme === 'cream' ? 'rgba(220, 210, 180, 0.85)' : 'rgba(235, 240, 245, 0.85)',
      '--synth-actions-hover': theme === 'night' ? '#31556b' : theme === 'cream' ? '#b8a88d' : '#c0d0e0',
      '--synth-take-failed-border': theme === 'night' ? '#805467' : theme === 'cream' ? '#b8809d' : '#c5708f',
      '--synth-take-failed-text': theme === 'night' ? '#d9a7b8' : theme === 'cream' ? '#8a5d6d' : '#9a5d7d',
      '--synth-token-readout': theme === 'night' ? '#c7b7dc' : theme === 'cream' ? '#8a7a9d' : '#7d6a9d',
      '--synth-reference-invalid': theme === 'night' ? '#d28b68' : theme === 'cream' ? '#c8805d' : '#d5906d',
      '--synth-progress-midi': theme === 'night' ? 'linear-gradient(90deg, #79c0ff, #f0c45c)' : theme === 'cream' ? 'linear-gradient(90deg, #6b95d5, #d4b85c)' : 'linear-gradient(90deg, #5ba3ff, #e0b84d)',
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
    if (!isMidiInstrument(settings.midiInstrument)) settings.midiInstrument = defaults.midiInstrument
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
    surface: '#0B0E14', panel: '#161b22', elevated: '#1f2937', border: '#374151',
    text: '#F8FAFC', muted: '#94a3b8', accent: '#22D3EE', accentHover: '#06b6d4',
    accentPressed: '#0891b2', hover: '#1e293b', selected: '#0f3a5f', located: '#422006',
    warning: '#F59E0B', danger: '#ef4444', success: '#10b981',
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
    return { ...defaults, ...parsed, showRomaji: false,
      midiInstrument: isMidiInstrument(parsed.midiInstrument) ? parsed.midiInstrument : defaults.midiInstrument }
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
