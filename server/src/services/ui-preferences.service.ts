import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface UiPreferences { showRomaji: boolean }

export class UiPreferencesRepository {
  constructor(private readonly file = fileURLToPath(new URL('../../data/ui-preferences.json', import.meta.url))) {}

  read(): UiPreferences {
    if (!fs.existsSync(this.file)) return { showRomaji: false }
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    if (typeof value.showRomaji !== 'boolean') throw new Error('显示设置文件无效')
    return { showRomaji: value.showRomaji }
  }

  write(value: unknown): UiPreferences {
    if (!value || typeof value !== 'object' || typeof (value as UiPreferences).showRomaji !== 'boolean') {
      throw new Error('showRomaji 必须为布尔值')
    }
    const preferences = { showRomaji: (value as UiPreferences).showRomaji }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(preferences, null, 2), 'utf8')
    fs.renameSync(temporary, this.file)
    return preferences
  }
}
