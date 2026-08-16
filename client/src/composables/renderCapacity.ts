import { useRenderPanelStore } from '@/stores/renderPanel'
import { useGpuRuntimeStore } from '@/stores/gpuRuntime'

export async function ensureRenderCapacity(
  modelIds: string[],
  durationSeconds: number,
): Promise<boolean> {
  const renderPanel = useRenderPanelStore()
  const gpuRuntime = useGpuRuntimeStore()
  if (gpuRuntime.runtimes.some(item => item.state === 'busy')) {
    if (modelIds[0].includes('MSST')) renderPanel.setMsstFailed('模型正在运行其他任务')
    else renderPanel.setWhisperFailed('模型正在运行其他任务')
    return false
  }

  const plan = await gpuRuntime.planCompositeRoute(modelIds, durationSeconds)
  if (!plan.ok) {
    const action = await renderPanel.requestCapacity({
      requiredMiB: plan.requiredMiB,
      freeMiB: plan.freeMiB,
      insufficient: true,
      evictions: [],
      modelIds,
    })
    return action === 'force'
  }

  if (plan.evictions.length === 0 || gpuRuntime.runtimeMode === 'auto') {
    await gpuRuntime.applyCompositePlan(plan)
    return true
  }

  const action = await renderPanel.requestCapacity({
    requiredMiB: plan.requiredMiB,
    freeMiB: plan.freeMiB,
    insufficient: false,
    evictions: plan.evictions,
    modelIds,
  })
  if (action === 'cancel') return false
  if (action === 'force') return true
  await gpuRuntime.applyCompositePlan(plan)
  return true
}
