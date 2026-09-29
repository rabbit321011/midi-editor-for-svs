<script setup lang="ts">
import { computed, onMounted, watchEffect } from 'vue'
import { darkTheme, NConfigProvider, NGlobalStyle, type GlobalThemeOverrides } from 'naive-ui'
import { useUiSettingsStore } from '@/stores/uiSettings'

const uiSettings = useUiSettingsStore()
onMounted(() => { void uiSettings.loadServerPreferences() })
const naiveTheme = computed(() => uiSettings.settings.theme === 'night' ? darkTheme : null)
const naiveThemeOverrides = computed<GlobalThemeOverrides>(() => {
  const palette = uiSettings.palette
  return {
    common: {
      primaryColor: palette.accent,
      primaryColorHover: palette.accentHover,
      primaryColorPressed: palette.accentPressed,
      primaryColorSuppl: palette.accentHover,
      bodyColor: palette.surface,
      cardColor: palette.panel,
      modalColor: palette.elevated,
      popoverColor: palette.elevated,
      inputColor: palette.panel,
      actionColor: palette.panel,
      tableColor: palette.panel,
      textColorBase: palette.text,
      textColor1: palette.text,
      textColor2: palette.text,
      textColor3: palette.muted,
      borderColor: palette.border,
      dividerColor: palette.border,
      hoverColor: palette.hover,
    },
  }
})

watchEffect(() => {
  const root = document.documentElement
  root.classList.remove('theme-night', 'theme-light', 'theme-cream')
  root.classList.add(uiSettings.rootClass)
  for (const [name, value] of Object.entries(uiSettings.cssVars)) root.style.setProperty(name, value)
})
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="naiveThemeOverrides">
    <NGlobalStyle />
    <router-view />
  </NConfigProvider>
</template>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--app-surface);
  color: var(--app-text);
  overflow: hidden;
}

html,
body,
#app { min-height: 100%; }
</style>
