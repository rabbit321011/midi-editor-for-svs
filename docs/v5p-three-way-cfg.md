# V5-P 三路 CFG

## 目的

V5-P 训练时对三类条件独立执行 classifier-free dropout：

| 条件 | 训练 dropout |
|---|---:|
| A 区参考音频 | 0.30 |
| Text / H token | 0.15 |
| MIDI-P | 0.30 |

`V5P_40K_EMA`（non-g）和 `V5Pg_20K` 都具备这份训练依据。编辑器因此允许用户分别调节三类条件的引导强度。

## 用户入口

合成单元编辑器的 A 区参考栏中，生成 Take 按钮左侧显示紧凑采样按钮：

```text
CFG 1.0
```

三路模式显示：

```text
3CFG A1.0 T1.0 M1.0
```

点击按钮才展开“高级采样控制”。默认保持收起，不增加主编辑页面高度。

菜单提供：

- 引导模式：统一 CFG / 三路 CFG；
- A 区音色 CFG；
- Text / H CFG；
- MIDI-P CFG；
- 采样步数；
- Seed；
- 当前模型的训练 dropout 说明。

当前不提供经验预设。预设要等真实工程中积累出稳定组合后再加入。

## 参数语义

- A 区音色 CFG：加强对参考音频音色、唱法和声学特征的遵循；
- Text / H CFG：加强对 H token、歌词和发音时序的遵循；
- MIDI-P CFG：加强对音高和音符边界的遵循；
- 0 表示不增加该条件的 CFG 差分，不表示从模型输入中删除该条件；
- 数值允许 0 到 10，步进 0.1；初期建议在 0 到 3 内试听；
- 数值过高可能造成僵硬、失真或条件竞争。

## 引导公式

三路模式顺序计算四个训练中存在的条件分支：

```text
v0    = A、Text、MIDI 全部丢弃
vA    = 只保留 A
vAT   = 保留 A + Text
vFull = 保留 A + Text + MIDI
```

输出速度：

```text
v = vFull
  + cfgA    * (vA    - v0)
  + cfgText * (vAT   - vA)
  + cfgMidi * (vFull - vAT)
```

公式版本冻结为：

```text
audio-text-midi-telescoping.v1
```

当三个值都为 `c` 时，差分会 telescoping：

```text
v = vFull + c * (vFull - v0)
```

因此 `A=c / Text=c / MIDI=c` 与当前统一 `CFG=c` 的数学结果一致。切换到三路模式时，三个值从当前统一 CFG 初始化。

## 运行方式和显存

第一版按 `v0 -> vA -> vAT -> vFull` 顺序执行四个分支，不拼成四倍 batch：

- 常驻 DiT 和 VAE 不变；
- 峰值显存暂按现有统一 CFG 标定保守估算；
- 预计运行时间约为统一 CFG 的 2 倍；
- 显存请求显式携带 `guidanceMode=three-way`；
- 估算结果标记 `profilePolicy=sequential-branch-peak`，不冒充三路实测 profile；
- 后续真实标定可以替换该估算，不改变用户参数合同。

模型仍由当前显存管理系统加载、释放和执行。3CFG 不启动旁路进程。

## 保存与审计

合成单元保存下次生成使用的设置：

```ts
samplingSettings: {
  guidance:
    | { mode: 'unified'; cfg: number }
    | {
        mode: 'three-way';
        audio: number;
        text: number;
        midi: number;
        formula: 'audio-text-midi-telescoping.v1';
      };
  steps: number;
  seed: number;
}
```

点击生成时会冻结一份设置到新 Take。随后修改菜单只影响新 Take，不修改旧 Take。服务端 preflight、job manifest、runner audit 和 result 都保存同一份 guidance、steps 和 seed；客户端验证服务端结果必须与冻结请求一致。

旧工程没有 `samplingSettings` 时按以下值读取：

```text
统一 CFG = 1
steps = 32
seed = 42
```

## 当前支持模型

| 模型 | 3CFG | 训练依据 |
|---|---|---|
| V5P_40K_EMA | 支持 | non-g Phase B：A 0.30 / Text 0.15 / MIDI 0.30 |
| V5Pg_20K | 支持 | checkpoint args `drop_text=0.15`，A/MIDI 各 0.30 |

模型能力由目录中的 `supportsThreeWayCfg` / `three-way-cfg` 声明。未来模型没有训练依据时，编辑器禁用三路选项。
