# V5-P 句级 MIDI-P 重提取

## 目的

合成单元内部的 GAME 自动提取可能把多个不同音高的音符切成一个长音。现在可以针对单个 Segment 重新提取，不影响其他句、其他文字轨或 Guide。

## 用户入口

在合成单元编辑器中右键某个 Segment，选择：

```text
重提取本句 MIDI-P
```

面板中的提取结果都是候选。生成完成后不会自动覆盖当前 MIDI-P，必须明确点击“应用 GAME”或“应用 SOME”。

## 提取范围

Segment 的写入范围是：

```text
[当前 Segment.startFrame, 下一个 Segment.startFrame)
```

最后一个 Segment 的结束位置是合成单元的 `frameCount`。

送入提取器时可以附带上下文 frame，默认 7 frame。上下文只用于改善句首/句尾判断，不会写入目标范围外的 MIDI-P。

应用候选时：

- 目标范围内的 MIDI-P 被候选替换；
- 范围外的 MIDI-P 完全保持不变；
- 目标范围内旧的手工 provenance 被清除；
- Segment、Kana、H Token、Guide 和其他句保持不变；
- 操作产生一次 MIDI-P revision，可以通过 Ctrl+Z 撤销。

## 两种提取器

### GAME

GAME 是 V5-P 训练侧使用的 MIDI-P 来源，默认参数保持：

- boundary threshold: `0.2`
- boundary radius: `2`
- presence threshold: `0.2`
- nsteps: `4`

高级参数允许调整：

- boundary threshold：越低越容易产生新边界；
- boundary radius：越小越允许相邻边界；
- presence threshold：越低越不容易把轻声判成 REST；
- nsteps：`4 / 8 / 16`；
- seed：默认由 Guide 和局部范围稳定生成，也可以显式输入。

### SOME

SOME 是真正运行的 OpenVPI-SOME 模型，不是 GAME 的 `SOME-compatible` 概率映射。

当前使用：

- checkpoint: `E:/MyProject/ToLinuxServer/TEMP/uploads_models/some.pt`
- hop: `512 samples`
- 采样率: `44100 Hz`
- 原生分析约 `86.13 fps`
- 输出再对齐到 V5-P 的 `2048 samples/frame`

SOME 适合提供另一套帧级音高和边界证据，但不属于 V5-P 的训练 MIDI-P 来源。它可能比 GAME 更容易切出短音，也可能把滑音或颤音切得过碎。

SOME 参数允许调整：

- boundary bias：提高后更敏感；
- REST threshold；
- 最短音符 frame，过短候选会并入前一个音符；
- 上下文 frame。

## 对比模式

选择“对比”时按当前显存计划依次运行 GAME 和 SOME。两个结果都保留在面板中，用户可以切换：

- 当前 MIDI-P；
- GAME 候选；
- SOME 候选。

候选试听复用编辑器现有 MIDI-P 钢琴和慢放功能，点击候选试听按钮会切换到 MIDI-P 播放模式。当前 Guide 不会被强制切换或覆盖。

第一版不自动融合 GAME 与 SOME。用户需要明确选择一个候选应用。

## 显存管理

GAME 和 SOME 都是 Analysis Runtime：

- GAME Runtime ID: `GAME-1.0-medium`
- SOME Runtime ID: `OpenVPI-SOME`

局部提取必须经过现有 `prepareCompositeTask()` 显存规划。SOME 不会通过旁路一次性 Python 进程运行：

- 用户可以在显存页手动加载/释放 SOME；
- Runtime 常驻模型和推理峰值分开估算；
- 对比模式按组合任务规划；
- 显存不足时沿用现有确认/释放流程；
- 用户取消时不改写当前 MIDI-P；
- SOME 完成推理后回报 `resident_updated`，后续估算使用实测常驻值。

SOME 尚未有长期标定 profile 时，目录使用保守初始峰值估算；首次实际运行后会写入 `data/vram-profile/OpenVPI-SOME.resident.json`。

## 当前边界

- 当前候选协议保留 GAME `noteIds`，但编辑器仍以 dense class 和现有 FLOW 规则工作；同音高边界暂不作为独立实体处理。
- SOME 候选的 `rawNotes` 当前为空，边界由 dense class 和候选统计体现。
- 自动融合规则暂不实现，待真实使用样本积累后再决定。
