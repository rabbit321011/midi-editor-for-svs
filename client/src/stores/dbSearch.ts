import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DbPoint } from '@/utils/dbSearchGeometry'

export const useDbSearchStore = defineStore('dbSearch', () => {
  const settings = ref({ vectorLibraryPath: '', audioLibraryPath: '' })
  const settingsLoaded = ref(false)
  const busySettings = ref(false)
  const settingsMessage = ref('')
  const inputId = ref<string | null>(null)
  const strict = ref(true)
  const points = ref<DbPoint[]>([])
  const selectedId = ref<string | null>(null)
  const searching = ref(false)
  const message = ref('')

  async function responseJson(response: Response) {
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'DB 请求失败')
    return result
  }
  async function loadSettings() {
    if (settingsLoaded.value || busySettings.value) return
    busySettings.value = true
    try {
      settings.value = await responseJson(await fetch('/api/db/settings'))
      settingsLoaded.value = true
    } catch (error: any) { settingsMessage.value = error.message }
    finally { busySettings.value = false }
  }
  async function saveSettings() {
    busySettings.value = true
    try {
      settings.value = await responseJson(await fetch('/api/db/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings.value),
      }))
      settingsLoaded.value = true
      points.value = []
      selectedId.value = null
      settingsMessage.value = '已保存'
    } catch (error: any) { settingsMessage.value = error.message }
    finally { busySettings.value = false }
  }
  async function checkSettings() {
    busySettings.value = true
    try {
      const result = await responseJson(await fetch('/api/db/check', { method: 'POST' }))
      settingsMessage.value = `${result.validRows} / ${result.rows} 句可检索 · ${result.dimension}D`
    } catch (error: any) { settingsMessage.value = error.message }
    finally { busySettings.value = false }
  }
  return { settings, settingsLoaded, busySettings, settingsMessage, inputId, strict, points, selectedId, searching, message, responseJson, loadSettings, saveSettings, checkSettings }
})
