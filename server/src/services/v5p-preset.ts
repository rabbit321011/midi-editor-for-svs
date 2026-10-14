export const V5P_RUNTIME = 'E:/MyProject/ToLinuxServer/package_v4c_finetune'
export const V5P_PYTHON = 'C:/Users/jbbj/AppData/Local/Programs/Python/Python310/python.exe'
export const SINGER_ROOT = 'E:/AIscene/YingMusic_Singer_Plus'
export const V5P_DIRECT_RUNNER = 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_runner.py'

export const V5P_MODEL_IDS = ['V5P_40K_EMA', 'V5Pg_20K', 'V5PgO_8K', 'V5Sg_40K_EMA', 'V5PgOV_300K_EMA', 'V5F_F1_3K_EMA', 'V5F_F1_6K_EMA'] as const

export type V5PModelId = typeof V5P_MODEL_IDS[number]

export interface V5PDirectPreset {
  id: V5PModelId
  label: string
  vaeLabel: string
  checkpoint: string
  checkpointSHA256: string
  checkpointSchema: string
  checkpointStep: number
  emaStepOffset: number
  weightSource: string
  trainingCodeSHA256: string
  modelConfig: string
  modelConfigSHA256: string
  vaeConfig: string
  vaeConfigSHA256: string
  vaeCheckpoint: string
  vaeCheckpointSHA256: string
  vaeDecoderCheckpoint?: string
  vaeDecoderCheckpointSHA256?: string
  placement: string
  placementSHA256: string
  directControlAdapter: string
  directRunner: string
  python: string
  singerRoot: string
  melodyHashes: Record<string, string>
  supportsThreeWayCfg: boolean
  baseCheckpoint?: string
  baseCheckpointSHA256?: string
  f1Support?: string
  f1SupportSHA256?: string
  f1Loader?: string
  sgResources?: Record<string, { path: string; sha256: string }>
  sgLoader?: string
}

export function supportsMultiReferenceModel(id: string): boolean {
  return id === 'V5PgO_8K' || id === 'V5Sg_40K_EMA'
}

const LEGACY_PRESETS: Record<Exclude<V5PModelId, 'V5Sg_40K_EMA' | 'V5F_F1_3K_EMA' | 'V5F_F1_6K_EMA'>, V5PDirectPreset> = {
  V5P_40K_EMA: {
  id: 'V5P_40K_EMA',
  label: 'V5-P 40K EMA',
  vaeLabel: '官方 20 Hz VAE',
  checkpoint: 'E:/MyProject/重要模型保存/V5P_40K_EMA/step_040000_final.pt',
  checkpointSHA256: '3a532f5bd5965dff7d011996b7ca72d7884c5494a2d44d6c28b0bab21bace96c',
  checkpointSchema: 'v5p_training_checkpoint_v1',
  checkpointStep: 40000,
  emaStepOffset: 0,
  weightSource: 'ema_model_state_dict',
  trainingCodeSHA256: '68ca0d402a79a0ffddaec0a740d4c1ae1edd4732ce93ca5d30240fdc75a9ed8f',
  modelConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/YingMusic_Singer.yaml',
  modelConfigSHA256: 'e378b3b0891e82b0b03a2e183adca292c7c17e7fbd9bec9acfe426a3596f567d',
  vaeConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/stable_audio_2_0_vae_20hz_official.json',
  vaeConfigSHA256: '6c70de797bae6a3362ed7f2afb91d19ce5c979cdd2dbfa4ae000b9bdef02acbc',
  vaeCheckpoint: `${SINGER_ROOT}/ckpts/stable_audio_2_0_vae_20hz_official.ckpt`,
  vaeCheckpointSHA256: 'dc2c4a8ec9731594951a27eff4a188a89b82859649c341c51d050101d1ce0b39',
  placement: `${V5P_RUNTIME}/h_alignment/placement.py`,
  placementSHA256: '086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee',
  directControlAdapter: 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_control.py',
  directRunner: V5P_DIRECT_RUNNER,
  python: V5P_PYTHON,
  singerRoot: SINGER_ROOT,
  supportsThreeWayCfg: true,
  melodyHashes: {
    'game_cache_v4ph.py': '2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd',
    'game_cka_v4ph.py': '43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba',
    'game_p_v4pf.py': '5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8',
    'game_runtime_v4ph.py': 'cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4',
    'midi_p_v4ph.py': 'b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f',
  },
  },
  V5Pg_20K: {
    id: 'V5Pg_20K',
    label: 'V5-Pg 20K',
    vaeLabel: '285k online VAE',
    checkpoint: 'E:/MyProject/重要模型保存/V5Pg_20K/step_020000_final.pt',
    checkpointSHA256: '36c424a6c4e1afabf9e1d7d29a343b4d6816e869297b021e05001b9cf1d2143f',
    checkpointSchema: 'v5pg_training_checkpoint_v1',
    checkpointStep: 20000,
    emaStepOffset: 40000,
    weightSource: 'ema_model_state_dict',
    trainingCodeSHA256: '50e186047afbed0566b83bf06b1fcc816e73691b1ed2ec76d06f147f97517e59',
    modelConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/YingMusic_Singer.yaml',
    modelConfigSHA256: 'e378b3b0891e82b0b03a2e183adca292c7c17e7fbd9bec9acfe426a3596f567d',
    vaeConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/stable_audio_2_0_vae_20hz_official.json',
    vaeConfigSHA256: '6c70de797bae6a3362ed7f2afb91d19ce5c979cdd2dbfa4ae000b9bdef02acbc',
    vaeCheckpoint: `${SINGER_ROOT}/ckpts/autoencoder_285k.ckpt`,
    vaeCheckpointSHA256: 'f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85',
    placement: `${V5P_RUNTIME}/h_alignment/placement.py`,
    placementSHA256: '086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee',
    directControlAdapter: 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_control.py',
    directRunner: V5P_DIRECT_RUNNER,
    python: V5P_PYTHON,
    singerRoot: SINGER_ROOT,
    supportsThreeWayCfg: true,
    melodyHashes: {
      'game_cache_v4ph.py': '2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd',
      'game_cka_v4ph.py': '43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba',
      'game_p_v4pf.py': '5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8',
      'game_runtime_v4ph.py': 'cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4',
      'midi_p_v4ph.py': 'b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f',
    },
  },
  V5PgO_8K: {
    id: 'V5PgO_8K',
    label: 'V5-PgO 8K',
    vaeLabel: '285k online VAE',
    checkpoint: 'E:/MyProject/重要模型保存/V5PgO/step_008000_final.pt',
    checkpointSHA256: '6882e0be20ca32a0e2dff9619efa47612ed4ca33f0d4cbc78d1de3da8023d6cc',
    checkpointSchema: 'v5pgo_training_checkpoint_v1',
    checkpointStep: 8000,
    emaStepOffset: 0,
    weightSource: 'ema_model_state_dict',
    trainingCodeSHA256: 'bc2885c458a4c28a70b91cbb4c07c86fe5a795e2172f7313495d4330b7736731',
    modelConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/YingMusic_Singer.yaml',
    modelConfigSHA256: 'e378b3b0891e82b0b03a2e183adca292c7c17e7fbd9bec9acfe426a3596f567d',
    vaeConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/stable_audio_2_0_vae_20hz_official.json',
    vaeConfigSHA256: '6c70de797bae6a3362ed7f2afb91d19ce5c979cdd2dbfa4ae000b9bdef02acbc',
    vaeCheckpoint: `${SINGER_ROOT}/ckpts/autoencoder_285k.ckpt`,
    vaeCheckpointSHA256: 'f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85',
    placement: `${V5P_RUNTIME}/h_alignment/placement.py`,
    placementSHA256: '086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee',
    directControlAdapter: 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_control.py',
    directRunner: V5P_DIRECT_RUNNER,
    python: V5P_PYTHON,
    singerRoot: SINGER_ROOT,
    supportsThreeWayCfg: true,
    melodyHashes: {
      'game_cache_v4ph.py': '2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd',
      'game_cka_v4ph.py': '43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba',
      'game_p_v4pf.py': '5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8',
      'game_runtime_v4ph.py': 'cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4',
      'midi_p_v4ph.py': 'b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f',
    },
  },
  V5PgOV_300K_EMA: {
    id: 'V5PgOV_300K_EMA',
    label: 'V5-PgOV 300K EMA',
    vaeLabel: '285k online VAE + V 300K EMA decoder',
    checkpoint: 'E:/MyProject/重要模型保存/V5PgO/step_008000_final.pt',
    checkpointSHA256: '6882e0be20ca32a0e2dff9619efa47612ed4ca33f0d4cbc78d1de3da8023d6cc',
    checkpointSchema: 'v5pgo_training_checkpoint_v1',
    checkpointStep: 8000,
    emaStepOffset: 0,
    weightSource: 'ema_model_state_dict',
    trainingCodeSHA256: 'bc2885c458a4c28a70b91cbb4c07c86fe5a795e2172f7313495d4330b7736731',
    modelConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/YingMusic_Singer.yaml',
    modelConfigSHA256: 'e378b3b0891e82b0b03a2e183adca292c7c17e7fbd9bec9acfe426a3596f567d',
    vaeConfig: 'E:/MyProject/重要模型保存/V4H_24k/runtime_20260729/stable_audio_2_0_vae_20hz_official.json',
    vaeConfigSHA256: '6c70de797bae6a3362ed7f2afb91d19ce5c979cdd2dbfa4ae000b9bdef02acbc',
    vaeCheckpoint: `${SINGER_ROOT}/ckpts/autoencoder_285k.ckpt`,
    vaeCheckpointSHA256: 'f18aeecacc04173cd2ea73bbdf8edae9e976d18e4ca050c38e2723281c5cba85',
    vaeDecoderCheckpoint: 'E:/MyProject/ToLinuxServer/deliverables/V5PgOV_300K_EMA/V5PgOV_300K_EMA_decoder.pt',
    vaeDecoderCheckpointSHA256: 'a1755fbde268039163809e884fd8d15849dae9c415fef4714c87a838abe842cb',
    placement: `${V5P_RUNTIME}/h_alignment/placement.py`,
    placementSHA256: '086d4e65432d27a7513cac5e61343f89554711c8194bb4258667d0d2c106a2ee',
    directControlAdapter: 'E:/AIscene/AISVC-midi-web/server/scripts/v5p_direct_control.py',
    directRunner: V5P_DIRECT_RUNNER,
    python: V5P_PYTHON,
    singerRoot: SINGER_ROOT,
    supportsThreeWayCfg: true,
    melodyHashes: {
      'game_cache_v4ph.py': '2bd07ff9c9c3748289e4c2a65a4e8fa1b1cbf52fce2fdf689252a85a87ae17bd',
      'game_cka_v4ph.py': '43071b4b4401e202f84e86a729694e4973118b8a4132128f52eacd3e16fb94ba',
      'game_p_v4pf.py': '5cea9223b94897dc0277fbc330e72187795154f9859a0285453fa48fe0e6dce8',
      'game_runtime_v4ph.py': 'cb46560b2fd10010b38048b891f8fccb2a12e3acd7a314f186ff8ee43b834bd4',
      'midi_p_v4ph.py': 'b33101ac135815bfcd3a3a2ba2233ddee0f5f7321285327871758804119e271f',
    },
  },
}

const F1_ROOT = 'E:/MyProject/重要模型保存/V5F_F1_3K_6K'
function f1Preset(id: 'V5F_F1_3K_EMA' | 'V5F_F1_6K_EMA', step: number, checkpointSHA256: string): V5PDirectPreset {
  return {
    ...LEGACY_PRESETS.V5PgO_8K,
    id, label: `V5-F F1 ${step / 1000}K EMA`, vaeLabel: 'F1 encoder + decoder LoRA / 285k online VAE',
    checkpoint: `${F1_ROOT}/step_${String(step).padStart(6, '0')}.pt`,
    checkpointSHA256, checkpointSchema: 'f1-adapter-checkpoint-v1',
    checkpointStep: step, weightSource: 'ema',
    trainingCodeSHA256: 'de3a959969443a88fdbe27ca85cc3b5b8f509805842aaf919794260ab68334d1',
    baseCheckpoint: LEGACY_PRESETS.V5PgO_8K.checkpoint,
    baseCheckpointSHA256: LEGACY_PRESETS.V5PgO_8K.checkpointSHA256,
    vaeConfig: 'E:/AIscene/AISVC-midi-web/server/models/f1/vae_config.json',
    vaeConfigSHA256: 'ca94f7c9d57dda4000ba2df87fc58229918359aca7d507847b91724f250551d4',
    f1Support: `${F1_ROOT}/F1_workbench_support.zip`,
    f1SupportSHA256: '68651055e0d4c8b30c7d5fd07e5646a32ab845960beae312dfe8f9e21bf8593f',
    f1Loader: 'E:/AIscene/AISVC-midi-web/server/scripts/f1_runtime.py',
  }
}
const V5P_DIRECT_PRESETS: Record<V5PModelId, V5PDirectPreset> = {
  ...LEGACY_PRESETS,
  V5Sg_40K_EMA: {
    ...LEGACY_PRESETS.V5PgO_8K,
    id: 'V5Sg_40K_EMA', label: 'V5-Sg 40K EMA', vaeLabel: '285k VAE / continuous SOME',
    checkpoint: 'E:/MyProject/重要模型保存/V5Sg/step_040000_final.pt',
    checkpointSHA256: '739f034437c1165cd7ef40e860a355e82a1cab791a195ee69f210192144b8249',
    checkpointSchema: 'v5sg_serial4_checkpoint_v1', checkpointStep: 40000,
    trainingCodeSHA256: '94ad6bc4b482dd9dbf32658590b563306fb5db770f28385de32b9aab5a234ccc',
    melodyHashes: {},
    sgLoader: 'E:/AIscene/AISVC-midi-web/server/scripts/sg_runtime.py',
    sgResources: {
      someCheckpoint: { path: `${SINGER_ROOT}/ckpts/model_ckpt_steps_100000_simplified.ckpt`,
        sha256: 'aa710fce920b4dae281b0e6cc2acba83345d82ee62d51f7bafeb29636f28f97c' },
      someExtractor: { path: `${SINGER_ROOT}/src/YingMusicSinger/melody/midi_extractor.py`,
        sha256: 'c9d8b1bd4be678cde1d45ad65fa5c2da42d5d3aeb09e1f0a8733e73604f9aba3' },
      someConformer: { path: `${SINGER_ROOT}/src/YingMusicSinger/melody/Gconform.py`,
        sha256: '8a406546da9c38fbca590673fc9abe84b0e1ad6cf706d728f23cabc8478b3caf' },
      someSmooth: { path: `${SINGER_ROOT}/src/YingMusicSinger/melody/SmoothMelody.py`,
        sha256: '36cfcdd705712ffe2d83405ab363255cebe18c404504adab914fc8d50fda9cb1' },
      someMel: { path: `${SINGER_ROOT}/src/YingMusicSinger/utils/mel_spectrogram.py`,
        sha256: 'fee7299ee705555b0c31c0a54df099c3c35320f1befbc8b618be7f00a37042f4' },
    },
  },
  V5F_F1_3K_EMA: f1Preset('V5F_F1_3K_EMA', 3000, '90d9eb27e730b796d9051046de1bb8c4e3f9993b97b3758bc31c03faaa596f23'),
  V5F_F1_6K_EMA: f1Preset('V5F_F1_6K_EMA', 6000, '0b22d3eeeb6b83da70909c5ffb29a5b924707d3cadbddbf8d8f872c46a56622c'),
}

export const V5P_DIRECT_PRESET = V5P_DIRECT_PRESETS.V5PgO_8K

export function getV5PDirectPreset(id: string): V5PDirectPreset {
  const preset = V5P_DIRECT_PRESETS[id as V5PModelId]
  if (!preset) throw new Error(`V5-P preset 无效: ${id}`)
  return preset
}

export function isV5PModelId(id: string): id is V5PModelId {
  return V5P_MODEL_IDS.includes(id as V5PModelId)
}
