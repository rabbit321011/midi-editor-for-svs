# MIDI Editor for SVS 使用教程（草稿）

> 本文按 2026-08-16 的实际前端界面编写，重点讲 V5-P 合成单元工作流。
> 它不是架构设计文档，也不要求用户理解训练代码。界面和操作仍在迭代，截图将在流程稳定后补充。

## 目录

1. [安装与启动](#1-安装与启动)
2. [认识主界面](#2-认识主界面)
3. [新建工程并导入音频](#3-新建工程并导入音频)
4. [时间线基础操作](#4-时间线基础操作)
5. [从 AudioObject 创建合成单元](#5-从-audioobject-创建合成单元)
6. [认识合成单元编辑器](#6-认识合成单元编辑器)
7. [准备 B 区：Segment、Kana、H Token 和 MIDI-P](#7-准备-b-区segmentkanah-token-和-midi-p)
8. [试听和检查控制轨](#8-试听和检查控制轨)
9. [准备并绑定 A 区参考](#9-准备并绑定-a-区参考)
10. [CFG、生成 Take 和导出](#10-cfg生成-take-和导出)
11. [显存管理](#11-显存管理)
12. [对象、资源与删除规则](#12-对象资源与删除规则)
13. [常用快捷键](#13-常用快捷键)
14. [常见问题](#14-常见问题)

## 最短完整流程

已经熟悉界面时，可以直接按这条路线操作：

```text
导入 Guide 音频
  -> 右键 AudioObject：创建音轨合成单元
  -> 双击 SYN：进入详细编辑页面
  -> Guide Audio：自动转录为 Segment
  -> 校对 Segment 的原文、Kana 和 Romaji
  -> Segment：自动对齐至 Kana
  -> 调整 Kana 内容和边界
  -> Segment：按当前 Kana 边界对齐至 H Token
  -> Guide Audio：GAME 自动生成 MIDI-P
  -> 检查并修改 MIDI-P
  -> 创建并准备另一个 SYN 作为 A 区参考
  -> 在 B 编辑器顶部绑定 A SYN
  -> 选择模型和 CFG
  -> 点击魔棒生成 Take
  -> 在 Takes 中试听比较
  -> 点击下载图标导出到正式音轨
  -> 保存项目
```

所有生成操作都需要用户显式执行。生成一条轨不会自动级联修改其他轨。

## 1. 安装与启动

### 1.1 使用发行包

1. 完整解压发行 ZIP。
2. 在包根目录运行 `安装程序.exe`。
3. 等待模型和运行环境安装完成。
4. 运行 `启动软件.cmd`。
5. 在浏览器打开 `http://127.0.0.1:8101/`。

安装后的目录会明显增大。模型和 Python/PyTorch 环境安装完成后，整个目录预计占用约 50 GB。

### 1.2 硬件建议

- Windows x64；
- NVIDIA 显卡；
- 建议 RTX 3060 或更高；
- 建议 12 GB 显存；
- 8 GB 显存可以尝试短任务，但并非所有任务都能完成；
- 不建议创建超过 60 秒的单个合成单元。

### 1.3 第一次检查

进入工程后，顶栏右侧会显示类似：

```text
GPU 1.7 GB / 11.9 GB
```

点击它可以进入显存页面。若始终显示 `GPU --`，先检查后端是否启动、NVIDIA 驱动是否可用。

## 2. 认识主界面

> 截图待补：主时间线全景，并标注顶栏、L1/L2、Timeline、右侧工具栏。

### 2.1 顶栏

从左到右主要包括：

- 播放、暂停、停止；
- “播放选中”开关；
- “文件”菜单；
- 当前项目名；
- GPU 显存入口；
- “键位教学”；
- “设置”。

“文件”菜单当前提供：

- 导入 WAV；
- 导入项目；
- 新建空音轨；
- 导出选中；
- 导出所有；
- 保存项目；
- 另存为 `.asvcproj`；
- 回到首页。

### 2.2 左侧 L1 / L2 文件树

左侧是两列对象树视图，均可展开：

| 目录 | 用途 |
|---|---|
| `workspace` | 暂时不放在时间线上的工作对象 |
| `resource` | 可重复拖入工程的资源对象 |
| `trackSources` | 时间线对象依赖的源对象 |
| `tracks` | 当前时间线轨道及其 TrackObject |
| `groups` | 对象组 |
| `renders` | 渲染结果 |

L1/L2 主要用于同时查看和拖动不同目录。初学时不必手工整理所有目录，先围绕 Timeline 和 SYN 操作即可。

L1和L2两个都是一个文件夹，只是分为两个方便拖动和编辑


### 2.3 中央编辑区

中央使用多标签页：

- `Timeline` 是主时间线；
- 双击 SYN 后会打开“某某 - 合成单元”标签；
- 显存、键位教学、设置也会作为标签打开。

### 2.4 右侧工具栏

当前开发版右侧保留 `SVC / SVS / Whisper / MSST / Chat` 等旧入口。V5-P 新流程主要发生在合成单元内部，不依赖旧 TextObject 或右侧旧 SVS 页面。

部分发行包会隐藏或禁用不随包提供的旧入口，这是正常现象。

## 3. 新建工程并导入音频

### 3.1 新建或打开项目

首页提供：

- “新建项目”；
- “导入项目”；
- 最近项目列表。

点击最近项目名称即可进入。项目数据修改后应使用 `Ctrl+S` 或“文件 -> 保存项目”。

### 3.2 导入 Guide 音频

进入项目后，可以：

1. 选择“文件 -> 导入 WAV”；
2. 或把音频文件拖到中央 Timeline。

导入后，时间线上会出现一个 AudioObject，轨道左侧显示名称、`M`、`S`、对齐和上下移动按钮，以及音量滑杆。

建议优先使用采样率稳定、没有损坏的 WAV。导入后先播放一次，确认音频内容和时间位置正确。

## 4. 时间线基础操作

> 截图待补：一条普通音频轨和一条合成单元轨。

### 4.1 轨道头按钮

| 控件 | 作用 |
|---|---|
| `M` | 静音该轨 |
| `S` | 独奏该轨 |
| 对齐按钮 | 将该轨最早片段对齐到 0 秒 |
| 上/下箭头 | 调整轨道顺序 |
| 百分比滑杆 | 调整轨道音量 |
| 重算按钮 | 强制重算普通音频轨的 F0 曲线 |

合成单元轨显示 MIDI 轮廓，而普通 AudioObject 轨显示 F0 轮廓。

### 4.2 移动片段

- 左右拖动时间线对象：修改它在主时间线中的开始时间；
- 把 SYN 移到另一条轨：修改其所属轨道；
- 移动时间线 SYN 后，其 Take 导出默认使用新的时间线位置；
- 修改后记得保存项目。

### 4.3 时间线右键菜单

右键普通 AudioObject：

```text
创建音轨合成单元
删除本音频段
定位到文件树
移动到 Workspace
```

右键时间线 SYN：

```text
进入详细编辑页面
定位到文件树
移动到 Workspace
删除本合成单元
```

时间线右键菜单没有“复制”。需要复制时，选中对象后使用 `Ctrl+C`、`Ctrl+V`。

## 5. 从 AudioObject 创建合成单元

### 5.1 创建

1. 在 Timeline 找到要处理的 AudioObject；
2. 右键音频块；
3. 选择“创建音轨合成单元”；
4. 等待新的 SYN 出现在单独的合成单元轨。

系统会把当前音频有效区间复制为该 SYN 自有的 `Owned Guide`。后续编辑不依赖原 AudioObject 一直留在原位置。

### 5.2 打开

可以：

- 双击时间线上的 SYN；
- 或右键 SYN，选择“进入详细编辑页面”。

编辑器会作为中央区域的新标签页打开。

### 5.3 A 和 B 需要两个 SYN

V5-P 生成需要两个合成单元：

- A：提供参考音色、唱法和 Text/H；
- B：提供目标 Guide、目标 Text/H 和 MIDI-P，也是最终要生成的内容。

因此通常要对两段音频分别创建 SYN。A 不能直接是普通 AudioObject，也不能与 B 是同一个 SYN。

## 6. 认识合成单元编辑器

> 截图待补：合成单元编辑器全景，并标注顶部播放区、A 区、模型、轨道、Inspector。

### 6.1 顶部播放工具条

从左到右包括：

- 播放与停止；
- 当前时间 / 总时长；
- `Guide / MIDI-P / Take` 播放源；
- Frame 缩放；
- `0.1x ~ 1.5x` 播放速度。

### 6.2 A 区参考栏

第二行显示：

- “A 区参考”；
- 当前绑定状态；
- “选择合成单元”；
- `CFG 1.0` 或 `3CFG A... T... M...`；
- 最右侧的绿色魔棒生成按钮。

未绑定 A 时，魔棒旁会直接提示“请先绑定 A 区参考合成单元”。

### 6.3 合成单元信息栏

这一行显示：

- 当前 SYN 名称和 revision；
- 当前 V5-P 模型选择器；
- frame 数；
- sample 数；
- 不能组成完整 VAE frame 的尾部 samples。

V5-P 的一个编辑 frame 是 2048 个 44.1 kHz PCM sample，约 46.44 ms。所有 H Token 和 MIDI-P 编辑都会落在整数 frame 上。

### 6.4 中央轨道

从上到下：

```text
Frame / Time
Source
  Guide Audio
Text
  Segment
  Kana
  H Token
Melody
  MIDI-P
```

右侧 Inspector 始终显示当前选中对象的属性和可用命令。例如选中 Guide 时，会显示时长、采样率、模型帧数，以及“转录 Segment”“生成 MIDI-P”。

### 6.5 滚动

- 合成单元内部鼠标滚轮始终用于横向浏览 frame；
- 使用 Frame 缩放控制每个 frame 的显示宽度；
- MIDI-P 轨本身较高，用于看清音高横线和音名；
- 右侧 Inspector 独立显示，不随中央时间轴滚动。

## 7. 准备 B 区：Segment、Kana、H Token 和 MIDI-P

推荐顺序：

```text
Segment -> 校对文本 -> Kana -> 校对边界 -> H Token -> MIDI-P
```

Segment/Kana/H/MIDI-P 是四条独立轨。任何自动命令只覆盖它明确声明的目标轨和 frame 范围。

### 7.1 生成完整 Segment 轨

在 Guide Audio 波形上右键，选择：

```text
自动转录为 Segment
```

也可以选中 Guide，在右侧 Inspector 点击“转录 Segment”。

这一步使用 Whisper 和 SOFA 生成句级对象。它会覆盖 Segment 轨，不会自动生成 Kana、H 或 MIDI-P。

### 7.2 Whisper 很差时手工创建 Segment

在 Segment 空白位置右键，选择：

```text
在此处新建 Segment
```

弹窗包含：

- 原文；
- Kana；
- Romaji；
- 起止 frame。

创建后，Kana/H/MIDI-P 保持不变。

### 7.3 校对 Segment

双击 Segment 打开编辑弹窗。推荐按以下顺序校对：

1. 先听 Guide，确认句子内容；
2. 修改 Kana 为实际唱出的正确假名；
3. 对照 Romaji 检查发音；
4. 调整起止 frame，使 Segment 覆盖完整句子；
5. 保存。

Kana 与 Romaji 在编辑弹窗中实时同步。不会日语时，可以主要依据 Romaji 校对，但最终 Kana 必须正确。

Segment 的左右边界可以直接拖动。选中 Segment 后按 `Delete` 可删除。

右键已有 Segment 还可以选择“重新转录本 Segment 文本”。它只重新识别当前句，不会改其他 Segment。

### 7.4 Segment 自动对齐至 Kana

右键已有 Segment，选择：

```text
自动对齐至 Kana
```

结果只写入该 Segment 对应的 Kana 范围。

Kana 轨由普通假名和 `SEG` 组成：

- 普通 Kana 表示一个 mora/假名单位；
- `SEG` 也是 Kana 轨上的普通单帧对象；
- `SEG` 用来保存分句边界，宽度固定为 1 frame。

双击 Kana 可以编辑 Kana/Romaji。拖动 Kana 主体可以整体移动，拖动左右边界可以调整其范围。相邻 Kana 不要求共享同一个边界，可以留下空隙。

### 7.5 从当前 Kana 生成 H Token

这一步有几条路线，含义不同。

#### 路线 A：按当前 Kana 硬边界对齐（推荐精修）

右键 Segment，选择：

```text
按当前 Kana 边界对齐至 H Token
```

它会把每个 mora 的音素限制在对应 Kana 的 frame 范围内。适合已经人工调整好 Kana 边界、希望 H 严格落在 Kana 内部时使用。

如果这条命令失败，界面会弹出阻塞错误，而不是一闪而过。先检查：

- 当前 Segment 下是否已有完整 Kana；
- Kana 末尾是否有 `SEG`；
- Kana 顺序和内容是否与实际歌词一致；
- 每个 Kana 是否有足够 frame 容纳音素。

#### 路线 B：按 Segment 文本自由对齐

右键 Segment，选择：

```text
按 Segment 文本自由对齐至 H Token（忽略 Kana 边界）
```

它按 Segment 文本执行自由 SOFA 对齐，不保证 H 落在现有 Kana 边界中。它适合快速生成，或 Kana 尚未精修的情况。

#### 路线 C：映射单个 Kana

右键 Kana，选择：

```text
映射至 H Token
```

映射不运行 SOFA，而是把该 Kana 转成对应 H Token，从 Kana 起点向后依次放置。若 Kana 太窄，会提示宽度不足。

#### 路线 D：自动对齐单个 Kana

右键 Kana，选择：

```text
自动对齐至 H Token
```

它使用 SOFA 对当前 Kana 做局部对齐。与“映射”相比，更依赖音频和现有 Kana 分句结构。

#### 路线 E：按 PUL 生成

右键 Segment，选择：

```text
按 PUL 生成 H Token
```

这条命令用于需要 PUL 控制的特殊工作流，不是普通歌词对齐的默认入口。

### 7.6 编辑 H Token

H Token 是单帧稀疏对象，不是铺满整段的长条：

- 悬浮：查看中文含义、token ID 和训练数据中是否见过；
- 左右拖动：移动到另一个离散 frame；
- 右键或双击任意 frame：打开 H Token 选择器并强制替换；
- 选中后 `Delete`：删除；
- 使用 Inspector：查看 frame、来源和 revision。

常见特殊 token：

- `PUL`：保持/填充控制；
- `SEP`：分句控制边界；
- 其他发音 token：表示具体音素。

完整中文 token 表见 [v5p-h-token-catalog-zh.md](v5p-h-token-catalog-zh.md)。

H 轨右键工具还支持清理或向后填充连续 PUL，用于批量编辑。

### 7.7 生成完整 MIDI-P

在 Guide Audio 上右键，选择：

```text
GAME 自动生成 MIDI-P
```

也可以选中 Guide，在 Inspector 点击“生成 MIDI-P”。

这会覆盖完整 MIDI-P 轨，不会改 Segment/Kana/H。

### 7.8 理解 MIDI-P、FLOW 和 REST

MIDI-P 是逐 frame 音高控制：

- 实体音高 token：一段连续音高的头部；
- `FLOW`：前端专用 token，继承前一个音高；
- `REST`：该 frame 无音高。

自动提取完成时，一个连续同音高 run 的首帧是实体音高 token，后续帧显示为 FLOW。FLOW 与普通实体 token 在编辑器中分别保存，避免把相邻的同音高音符错误合并。

### 7.9 编辑 MIDI-P

- 上下拖动实体 token：每一级改变 0.5 半音，并播放钢琴预览；
- 左右拖动：移动 token 的时间位置，源位置写入 REST；
- 右键任意 frame：打开“替换 MIDI-P”；
- 弹窗可精确选择 class/音名，或写入 FLOW、REST；
- 选中 token 后按 `Delete`：删除；
- 音高横线和 `C4/C5` 等标记用于判断音高位置。

FLOW 前必须存在一个有音高的 MIDI-P token。不能在第一帧或 REST 后直接写 FLOW。

### 7.10 局部重提取一句 MIDI-P

当 GAME 把多个音符合成一个长音时，右键对应 Segment，选择：

```text
重提取本句 MIDI-P
```

弹窗支持：

- GAME；
- OpenVPI-SOME；
- 对比两者；
- 调整边界、presence、REST、最短音符、上下文等参数；
- 试听当前 MIDI-P、GAME 候选或 SOME 候选。

候选生成完成后不会自动覆盖。必须显式点击“应用 GAME 到本句”或“应用 SOME 到本句”。写入范围是当前 Segment 到下一个 Segment 起点，其他句保持不变。

## 8. 试听和检查控制轨

### 8.1 三种播放源

合成单元顶部提供：

| 播放源 | 听到的内容 |
|---|---|
| `Guide` | 当前 B SYN 的 Owned Guide 原音频 |
| `MIDI-P` | 当前 MIDI-P 的钢琴预览 |
| `Take` | 当前选中的 V5-P 合成结果 |

先点击播放源，再按 `Space`。点击 Guide 波形只改变播放位置，不会强制切换播放源。

切换到其他标签页后，先点击新标签中的编辑区域，再使用空格，避免键盘焦点仍停留在旧页面。

### 8.2 定位和慢放

- 点击 Guide 波形：跳转播放头；
- 拖动或点击 frame ruler：定位到具体 frame；
- 速度滑杆：`0.1x ~ 1.5x`；
- MIDI-P 慢放适合检查音符边界；
- Guide 慢放适合检查辅音起点和 Kana/H 边界。

### 8.3 Inspector

选中 Segment、Kana、H Token 或 MIDI-P 后，右侧 Inspector 会显示当前对象的信息。编辑时应养成检查以下内容的习惯：

- 当前 frame 和时间；
- 当前 token/音名；
- 自动生成还是手工修改；
- 当前轨 revision；
- 当前可用命令。

## 9. 准备并绑定 A 区参考

### 9.1 准备 A SYN

A 必须是另一个合成单元。至少应确保：

- Owned Guide 可播放；
- Segment/Text 正确；
- H Token 已生成并检查；
- 不是当前 B SYN；
- 不会与 B 形成循环引用。

A 的 MIDI-P 不参与当前 V5-P A 区输入。

### 9.2 绑定

在 B 编辑器顶部“A 区参考”栏：

- 点击“选择合成单元”；
- 或把另一个 SYN 拖入该区域；
- 也可以拖入能够解析到该 SYN 的时间线 OBJ。

绑定成功后会显示 A 的名称、Guide 时长、unit revision 和 H revision，并标注“完整 Guide · 跟随最新”。

“跟随最新”表示 A 后续修改 H/Text 时，B 下次生成会读取最新版本。已经生成的旧 Take 仍保留生成时的快照。

### 9.3 A 区工具

绑定后可以：

- 试听 A 的完整 Guide；
- 打开 A 合成单元；
- 更换 A；
- 解除绑定。

## 10. CFG、生成 Take 和导出

### 10.1 选择模型

在合成单元名称右侧选择发行包提供的 V5-P 模型。不同发行包可见模型不同；只选择界面中显示为可用的模型。

切换模型会影响后续 Take，不会修改已有 Take。

### 10.2 CFG 设置

点击顶部紧凑按钮 `CFG 1.0` 展开高级采样控制。

统一 CFG 同时加强：

- A 区音色；
- Text/H；
- MIDI-P。

支持的模型还可以切换为三路 CFG：

| 参数 | 含义 |
|---|---|
| A 区音色 CFG | 加强参考音色、唱法和声学特征 |
| Text / H CFG | 加强歌词、发音和 H Token 时序 |
| MIDI-P CFG | 加强音高和音符边界 |

`CFG = 0` 表示不额外强化该条件差分，不表示删除该条件输入。过高数值可能造成僵硬、失真或条件竞争。

发行说明当前给出的三路起点是：

```text
A 0.4
Text 0.6
MIDI 0.7
```

这只是试听起点，不是所有歌曲的最佳值。三路模式通常比统一 CFG 慢。

菜单还提供采样步数和 Seed。设置会保存到新 Take 的记录中，修改设置不会改变旧 Take。

### 10.3 生成前检查

魔棒不可用时，先看旁边的文字提示。至少需要：

- B Guide 已加载；
- B H Token 已准备；
- B MIDI-P 已准备；
- A SYN 已绑定；
- A Guide 已加载；
- A H Token 已准备；
- 当前模型可用。

### 10.4 生成 Take

点击 A 区栏最右侧的绿色魔棒。

界面会经历：

```text
准备生成 Take
  -> 显存容量检查
  -> 模型加载/复用
  -> V5-P 推理进度
  -> Take 完成
```

生成期间不要关闭软件。可以切换标签页，但不要删除正在使用的 A/B SYN。

### 10.5 比较 Take

生成结果出现在 `Takes` 条中。每个 Take 保存自己的：

- A/B revision；
- Guide/H/MIDI-P 快照；
- 模型；
- CFG；
- steps；
- seed。

点击不同 Take 进行选择。选择可用 Take 后，播放源会切到 `Take`。旧 Take 不会因为你继续编辑 H/MIDI-P 而改变。

### 10.6 导出到正式音轨

选中满意的 Take，点击 Takes 条右侧的下载图标：

```text
导出当前 Take 到正式音轨
```

导出后，主 Timeline 会出现正式 AudioObject/TrackObject。Take 在 SYN 内仍然保留，可以继续比较或再次导出。

## 11. 显存管理

> 截图待补：显存页的 GPU 卡片、手动/自动模式、驻留 Runtime 和模型目录。

点击顶栏 GPU 数值进入显存页面。

### 11.1 页面内容

显存页包括：

- GPU 总显存、已用、可用和利用率；
- 本应用 GPU 任务；
- 驻留 Runtime；
- SVS/V5-P 模型目录；
- GAME、SOME、Whisper、SOFA、MSST 等分析 Runtime。

每个模型会显示任务显存估算、常驻显存和“加载模型”按钮。

### 11.2 手动模式

显存不足时弹窗，让用户选择：

- 强制运行；
- 删除最久未使用；
- 取消运行。

“强制运行”只表示继续尝试，不保证任务能完成。

### 11.3 自动模式

自动模式会按 LRU 尝试释放其他常驻模型。释放后仍不足时，才弹最终警告。

容量弹窗里的“当前可用”是当下空闲显存；可释放模型会在下面单独列出，不要把两者当成同一个数字。

### 11.4 手动加载和释放

- 经常重复生成同一模型时，可以提前点击“加载模型”；
- `ready` 表示模型已驻留；
- `busy` 表示正在执行任务；
- “释放模型”会关闭常驻 worker；
- “释放本应用全部显存”只处理本软件创建的任务，不结束其他程序。

## 12. 对象、资源与删除规则

### 12.1 时间线 SYN 和源 SYN

时间线上的 SYN 是 TrackObject；Workspace/Resource 中的 SYN 是源对象。

- 删除时间线 SYN：只删除当前编排实例；
- 源 SYN 仍在 Workspace/Resource，可再次拖回时间线；
- 直接删除源 SYN：会连带删除它拥有的 Guide、Take 和相关资产。

因此，想把对象暂时从时间线拿走时，使用“移动到 Workspace”或只删除时间线实例；确认不再需要整个合成单元时，才删除源 SYN。

### 12.2 Resource

Resource 中的 Audio/SYN 可以拖到时间线。SYN 拖入后创建新的时间线实例，不应因为删除这个实例而删除 Resource 源对象。

可发布对象还可以“加入全局 Resource”，供其他工程使用。

### 12.3 复制

选中 AudioObject 或 SYN 后：

```text
Ctrl+C
Ctrl+V
```

粘贴会创建新的时间线实例/对象。时间线右键菜单不提供复制按钮。

## 13. 常用快捷键

| 快捷键 | 作用 |
|---|---|
| `Space` | 播放/暂停当前页面选择的来源 |
| `Ctrl+S` | 保存项目 |
| `Ctrl+O` | 导入项目 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+Shift+Z` | 重做 |
| `Ctrl+C` / `Ctrl+V` | 复制/粘贴选中对象 |
| `Delete` | 删除选中对象、Kana、H 或 MIDI-P |
| `Alt+N` | 定位 TrackObject / SYN |
| `Alt+L` | 定位 AudioObject |
| `Ctrl+↑` / `Ctrl+↓` | 片段上移/下移一条音轨 |
| `Alt+Wheel` | 快速横向移动主 Timeline |
| `Ctrl+Wheel` | 上下浏览主时间线音轨 |
| 双击 | 打开对象或 Segment/Kana 编辑器 |

合成单元内部普通滚轮始终横向浏览 frame。

## 14. 常见问题

### 14.1 “创建合成单元”在哪里？

在 Timeline 的普通 AudioObject 音频块上右键，不是在空轨道或右侧 SVS 面板中寻找。

### 14.2 SYN 已经创建，但我没看到

SYN 会出现在单独的合成单元轨。尝试：

- 上下滚动时间线；
- 按 `Alt+N` 定位；
- 展开左侧 `tracks`；
- 保存并重新打开项目。

### 14.3 Segment 转录很差

可以：

- 右键空白 Segment 轨，“在此处新建 Segment”；
- 右键已有 Segment，“重新转录本 Segment 文本”；
- 双击 Segment 手工修改 Kana/Romaji；
- 拖动 Segment 边界。

### 14.4 为什么 H Token 跑到 Kana 外面？

确认你使用的是：

```text
按当前 Kana 边界对齐至 H Token
```

“按 Segment 文本自由对齐至 H Token”会忽略 Kana 边界，这是它的明确用途。

### 14.5 “按当前 Kana 边界对齐”没有生成 H

现在失败会弹出错误。常见原因：

- Segment 下没有 Kana；
- Kana 分句缺少末尾 `SEG`；
- SOFA 无法产生 mora tier；
- Kana 太窄；
- Kana 内容与音频严重不一致。

如果只想把当前假名直接转成 token，可使用 Kana 的“映射至 H Token”。

### 14.6 长音符号前没有可延长对象

当前长音符号需要前面已经存在可延长的发音单位。检查 Kana 顺序，避免让长音符号成为句首或紧跟 `SEG`。

### 14.7 GAME 把多个音符合成一个长音

右键对应 Segment，使用“重提取本句 MIDI-P”。尝试 GAME 参数、SOME 或对比模式，再明确应用一个候选。

### 14.8 MIDI-P 的 FLOW 为什么不能写？

FLOW 必须继承前一个有音高 token。第一帧、REST 后或无音高区域不能直接写 FLOW。

### 14.9 魔棒是灰色的

看魔棒右侧/旁边的提示。通常缺少：

- A 区绑定；
- A Guide/H；
- B Guide/H/MIDI-P；
- 可用 V5-P 模型。

### 14.10 生成很慢

第一次使用模型需要加载 checkpoint。显存页显示 `loading` 时耐心等待；进入 `ready` 后，后续任务通常会复用常驻模型。

三路 CFG 顺序执行多个条件分支，也会明显慢于统一 CFG。

### 14.11 显示“您的显存实在不足”

先进入显存页释放不需要的模型。若任务很长，可以：

- 缩短 SYN；
- 降低采样步数进行试音；
- 关闭其他占用 GPU 的程序；
- 只在了解风险时选择“强制运行”。

### 14.12 Take 已经满意，怎么回到主时间线？

在 Takes 条选择 Take，点击右侧下载图标。它会导出为正式音频并加入主 Timeline。只选择 Take 不会自动导出。

### 14.13 删除时间线 SYN 后，Resource 也应该删除吗？

不应该。时间线实例和 Resource 源对象不是同一个生命周期。要彻底删除，请在左侧文件树删除源 SYN；只删除时间线实例时，源 SYN 应继续保留。

## 后续补图清单

本文下一轮应补充以下截图：

1. 首页与最近项目；
2. 文件菜单；
3. 主时间线各区域；
4. AudioObject 右键菜单；
5. SYN 右键菜单；
6. 空白 Segment 的“在此处新建 Segment”；
7. 完整合成单元编辑器；
8. Segment 编辑弹窗；
9. Kana/H/MIDI-P 的选中和 Inspector；
10. 局部 MIDI-P 重提取弹窗；
11. A 区绑定和 CFG 菜单；
12. Takes 与导出按钮；
13. 显存管理页面。

