export type MsstModelId = 'duality' | 'dereverb' | 'denoise' | 'apollo' | 'aspiration' | 'bve'
export type MsstOutputId = 'vocals' | 'instrumental' | 'dry' | 'other' | 'restored' | 'addition' | 'aspiration'
export type MsstOutputMode = 'primary' | 'secondary' | 'both'

export interface MsstModelDefinition {
  id: MsstModelId
  label: string
  stageLabel: string
  primary: MsstOutputId
  secondary: MsstOutputId
  primaryLabel: string
  secondaryLabel: string
}

export const MSST_MODEL_DEFINITIONS: MsstModelDefinition[] = [
  {
    id: 'duality',
    label: '人声 / 伴奏分离',
    stageLabel: '分离人声/伴奏',
    primary: 'vocals',
    secondary: 'instrumental',
    primaryLabel: '人声',
    secondaryLabel: '伴奏',
  },
  {
    id: 'dereverb',
    label: '去混响 / 回声',
    stageLabel: '去混响/回声',
    primary: 'dry',
    secondary: 'other',
    primaryLabel: 'Dry',
    secondaryLabel: 'Other',
  },
  {
    id: 'denoise',
    label: '降噪',
    stageLabel: '降噪',
    primary: 'dry',
    secondary: 'other',
    primaryLabel: 'Dry',
    secondaryLabel: 'Other',
  },
  {
    id: 'apollo',
    label: 'Apollo 修复',
    stageLabel: 'Apollo 修复',
    primary: 'restored',
    secondary: 'addition',
    primaryLabel: '修复音频',
    secondaryLabel: '分离残留',
  },
  {
    id: 'aspiration',
    label: '去气声 / 呼吸声',
    stageLabel: '去气声/呼吸声',
    primary: 'other',
    secondary: 'aspiration',
    primaryLabel: '干净人声',
    secondaryLabel: '气声/呼吸',
  },
  {
    id: 'bve',
    label: '去和声',
    stageLabel: '去和声',
    primary: 'instrumental',
    secondary: 'vocals',
    primaryLabel: '主唱',
    secondaryLabel: '和声',
  },
]

export const MSST_MODEL_OPTIONS = MSST_MODEL_DEFINITIONS.map(item => ({
  label: item.label,
  value: item.id,
}))

export function getMsstModel(model: string): MsstModelDefinition {
  return MSST_MODEL_DEFINITIONS.find(item => item.id === model) ?? MSST_MODEL_DEFINITIONS[0]
}

export function selectedMsstOutputs(model: string, mode: string): MsstOutputId[] {
  const definition = getMsstModel(model)
  if (mode === 'primary') return [definition.primary]
  if (mode === 'secondary') return [definition.secondary]
  return [definition.primary, definition.secondary]
}

export function labelMsstOutput(model: string, outputId: MsstOutputId): string {
  const definition = getMsstModel(model)
  if (outputId === definition.primary) return definition.primaryLabel
  if (outputId === definition.secondary) return definition.secondaryLabel
  return outputId
}
