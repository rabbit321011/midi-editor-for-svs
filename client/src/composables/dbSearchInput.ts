import { combineSegmentsToBlob } from '@/api/wav'
import { makeRenderInputRef, resolveAudioRenderInputToSegmentInputs, type ProjectObjectTree, type TreeNode } from '@/object-workbench'
import type { AudioSegment, Track } from '@/types'

export function dbInputSource(node: TreeNode | undefined, nodes: Record<string, TreeNode>): TreeNode | undefined {
  return node?.kind === 'trackObject' ? nodes[node.trackObject.sourceObjectId] : node
}

export async function resolveDbSearchAudio(options: {
  node: TreeNode
  nodes: Record<string, TreeNode>
  tree: ProjectObjectTree
  sourceBlobs: Map<string, Blob>
  segments: Record<string, AudioSegment>
  tracks: Record<string, Track>
}): Promise<Blob> {
  const source = dbInputSource(options.node, options.nodes)
  if (source?.kind === 'synthesisUnit') {
    const asset = options.tree.assets[source.synthesisUnit.guide.assetId]
    const blob = asset?.blobKey ? options.sourceBlobs.get(asset.blobKey) : undefined
    if (!blob) throw new Error('SYN 的 Guide 音频不存在')
    return blob
  }
  if (source?.kind !== 'audio' && !(source?.kind === 'group' && source.group.mediaType === 'audio')) throw new Error('DB 输入只接受音频或 SYN（Guide）')
  if (options.node.kind === 'audio') {
    const asset = options.tree.assets[options.node.audio.assetId]
    const blob = asset?.blobKey ? options.sourceBlobs.get(asset.blobKey) : undefined
    if (!blob) throw new Error('音频资产不存在')
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer())
    if (String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WAVE') return blob
    // Only non-WAV imports need browser conversion; avoid resampling a native WAV.
  }
  const input = makeRenderInputRef(options.tree, options.node.kind === 'group' ? 'group' : options.node.kind === 'audio' ? 'audioObject' : 'trackObject', options.node.id)
  const resolved = await resolveAudioRenderInputToSegmentInputs({
    tree: options.tree, input, sourceBlobs: options.sourceBlobs, segments: options.segments, tracks: options.tracks,
  })
  return combineSegmentsToBlob(resolved.segmentInputs.map(segment => ({ ...segment, volume: 1 })), resolved.duration, 44100)
}
