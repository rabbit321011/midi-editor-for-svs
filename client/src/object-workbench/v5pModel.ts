export type V5PModelId = 'V5P_40K_EMA' | 'V5Pg_20K'

export const V5P_DEFAULT_MODEL: V5PModelId = 'V5P_40K_EMA'

export const V5P_MODEL_META: Record<V5PModelId, {
  label: string
  checkpointSHA256: string
  vaeSHA256: string
  adapterSHA256: string
  supportsThreeWayCfg: boolean
}> = {
  V5P_40K_EMA: {
    label: 'V5-P 40K EMA',
    checkpointSHA256: '3a532f5bd5965dff7d011996b7ca72d7884c5494a2d44d6c28b0bab21bace96c',
    vaeSHA256: 'dc2c4a8ec9731594951a27eff4a188a89b82859649c341c51d050101d1ce0b39',
    adapterSHA256: 'a61f6c9987b718555375b92ac4395384085d3f03c016d8cbb961f19f8ea7db38',
    supportsThreeWayCfg: true,
  },
  V5Pg_20K: {
    label: 'V5-Pg 20K',
    checkpointSHA256: '36c424a6c4e1afabf9e1d7d29a343b4d6816e869297b021e05001b9cf1d2143f',
    vaeSHA256: 'f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85',
    adapterSHA256: 'a61f6c9987b718555375b92ac4395384085d3f03c016d8cbb961f19f8ea7db38',
    supportsThreeWayCfg: true,
  },
}

export function isV5PModelId(value: string): value is V5PModelId {
  return value === 'V5P_40K_EMA' || value === 'V5Pg_20K'
}
