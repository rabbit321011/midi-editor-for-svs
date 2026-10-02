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
      borderRadius: '6px',
      borderRadiusSmall: '4px',
      fontSize: '14px',
      fontSizeMini: '11px',
      fontSizeTiny: '12px',
      fontSizeSmall: '13px',
      fontSizeMedium: '14px',
      fontSizeLarge: '15px',
      fontSizeHuge: '16px',
    },
    Button: {
      borderRadiusMedium: '6px',
      borderRadiusSmall: '5px',
      borderRadiusTiny: '4px',
      heightMedium: '32px',
      heightSmall: '28px',
      heightTiny: '24px',
      paddingMedium: '0 16px',
      paddingSmall: '0 12px',
      paddingTiny: '0 10px',
      fontWeightStrong: '600',
    },
    Input: {
      borderRadius: '6px',
      heightMedium: '32px',
      heightSmall: '28px',
      heightTiny: '24px',
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: '6px',
          heightMedium: '32px',
          heightSmall: '28px',
          heightTiny: '24px',
        },
      },
    },
    Card: {
      borderRadius: '8px',
      paddingMedium: '20px',
      paddingSmall: '16px',
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
  font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: var(--app-surface);
  color: var(--app-text);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

html,
body,
#app { min-height: 100%; }

/* 自定义滚动条样式 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-muted) 40%, transparent);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--app-muted) 60%, transparent);
  background-clip: padding-box;
}

::-webkit-scrollbar-corner {
  background: transparent;
}

/* 选中文本样式 */
::selection {
  background: color-mix(in srgb, var(--app-accent) 30%, transparent);
  color: var(--app-text);
}

/* 全局动画性能优化 */
* {
  -webkit-tap-highlight-color: transparent;
}

button, a {
  cursor: pointer;
  outline: none;
}

button:focus-visible, a:focus-visible {
  outline: 2px solid var(--app-accent);
  outline-offset: 2px;
}
</style>
