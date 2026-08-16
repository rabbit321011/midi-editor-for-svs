# V5-P 合成单元编辑器交接文档

## 当前状态

项目：`E:\AIscene\AISVC-midi-web`

当前处于实际合成联调阶段，主要工作是：

- 完善 V5-P 合成单元编辑器的交互
- 继续验证 GAME / Whisper / SOFA / MSST 的显存与 Runtime 行为
- 修复用户在真实合成流程中遇到的 bug

## 最近已完成

### 编辑器状态保留

- `EditorWorkspace.vue` 对 `SynthesisUnitEditor` 使用 `KeepAlive`，按 `objectId` 作为 key。
- 切走 Tab 不再销毁编辑器，选择、播放头、缩放、滚动位置会保留。
- `SynthesisUnitEditor.vue` 增加 `onActivated / onDeactivated`，切走时停止合成单元播放并解绑键盘，切回时恢复绑定。

### 键盘与快捷键

- `Ctrl+S`、`Ctrl+O` 现在在输入框内也会优先触发应用保存/打开，不再被浏览器保存网页抢走。
- `useKeyboard.ts` 和 `SynthesisUnitEditor.vue` 都做了拦截。
- 合成单元内空格播放修复为：焦点在按钮或普通编辑区也能播放；真正输入假名时仍允许输入空格。

### MIDI-P 编辑

- 单击 MIDI-P 音符会播放对应音高。
- FLOW 音符会解析到 head 音高再播放。
- REST / PAD 不播放。
- 右键替换面板里，FLOW 按钮在已是 FLOW 状态时变为“取消 FLOW”，并保留当前音高。

### Kana 编辑

- 修复 1-frame Kana 被 SEG 标签挡住右键的问题。
- `.kana-seg` 设置 `pointer-events: none`。
- Kana Inspector 现在显示“直接映射 H”，例如 `k i · 372, 363`。

### Segment 右键菜单

新增：

- `清空区域内 Kana`
- `清空区域内 H Token`

范围规则：

- Kana 清空范围：`segment.startFrame .. segment.speechEndFrameExclusive`
- H Token 清空范围：`segment.startFrame .. 下一个 Segment 起点或结尾`

### 进度显示

- 合成单元顶部增加全局分析进度条。
- `ensureAnalysisCapacity` 现在在模型加载/显存规划阶段就设置 `capacityPreparing`，顶部会显示：

```text
检查显存 / 加载 Whisper + SOFA
检查显存 / 加载 GAME
检查显存 / 加载 SOFA
```

- 原 MIDI 轨底部的小进度条已移除，统一放到顶部。

### MSST / 显存

- BVE 输出语义修正：

```ts
primary: 'instrumental',
secondary: 'vocals',
primaryLabel: '主唱',
secondaryLabel: '和声',
```

- PyTorch resident worker 在推理结束后会 `torch.cuda.empty_cache()` 并发 `resident_updated`。
- 覆盖 MSST、SOFA、GAME、SVS、V5P 等 PyTorch worker。
- Whisper 不走 PyTorch resident 更新，仍使用原 `nvidia-smi` 估算。
- `RenderPanel.vue` 长文件名不再把按钮挤出屏幕。

### GAME 模型信息

GAME 1.0 官方有三个规模：

| 规模 | 参数 |
| --- | --- |
| small | 12.7M |
| medium | 49.9M |
| large | 99.0M |

当前本地只接入 `GAME-1.0-medium`。

官方评测中 medium 综合最好，large 的 pitch RMSE 反而更差。

## 仍需注意 / 待办

- `projects/V5P Editor Dev/project.json` 和 `projects/明证/project.json` 不应提交。
- `exports/` 不上传。
- 客户端 `vue-tsc -b` 仍会因为缺少以下 fixture 失败：

```text
projects/DEMO1/project.json
projects/summerGoingEnd/project.json
```

- `pnpm --filter client exec vite build` 目前通过。
- `pnpm --filter server build` 目前通过。
- `pnpm --filter server test` 目前 39 个通过。

## 下一步建议

1. 继续实际合成并验证 GAME / Whisper / SOFA 常驻行为。
2. 如果 Whisper + SOFA 仍走 oneshot，检查 `gpuRuntime.prepareCompositeTask` 的多模型 resident 分支。
3. PUL 精细编辑仍建议继续围绕 Kana 级操作扩展，而不是只靠帧级点选。
4. 观察 `capacityPreparing` 是否还需要覆盖 V5-P Take 生成路径。
5. 正式提交前清理未确认的本地测试数据。
