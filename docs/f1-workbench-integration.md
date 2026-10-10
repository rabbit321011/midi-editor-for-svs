# F1 工作台适配

## 模型入口

- 新模型：`V5F_F1_3K_EMA`、`V5F_F1_6K_EMA`，对应本地 `V5F_F1_3K_6K` 目录的原始 3K/6K 检查点，固定使用 EMA。
- 新建 SYN 仍默认 PgO 8K。原有 CFG 默认值 A 0.4 / T 0.6 / M 0.5、步数 32、seed 42 不变。零 CFG 验证基线可将三路都设为 0。
- 新模型菜单和显存目录保留 PgO 8K 与 PgOV 300K EMA，只隐藏旧 V5P/Pg 选项。PgOV 显示及加载按钮通过前端热更新恢复，不修改运行中的后端；显存页对旧目录的 PgOV 隐藏标记做显示兼容。已保存的旧 SYN 保留其模型，当前隐藏旧选项以“旧工程”标注，不迁移权重或更改 Take；旧模型已加载时仍可释放。

## 资源合同

LoRA 原始检查点和支持包均为本地外部资源，不纳入编辑器 Git：

```text
E:/MyProject/重要模型保存/V5F_F1_3K_6K/
  step_003000.pt
  step_006000.pt
  F1_workbench_support.zip
```

必须匹配原 PgO 8K EMA 基座（SHA256 `6882e0be...`）和 285K online VAE（`f18aeeca...`）。
工作台读取原 PgO 检查点的 `ema_model_state_dict`，不是将原文件哈希误用为导出文件哈希。
VAE 使用随支持包提供的完整配置，文件位于 `server/models/f1/vae_config.json`。

预检绑定 adapter 检查点、基座、VAE、配置、支持 zip 和加载器哈希。加载器只执行支持包中
哈希匹配的原 `adapters.py`，不执行训练入口、优化器或 GPU 锁代码。

## 加载与推理

- 两步检查点严格区分 `completed`，不混用 online 和 EMA，不叠加 V 分支 decoder。
- DiT/encoder/decoder 注入数 136/37/37，420 个 FP32 LoRA 张量，共 6,721,152 参数。
- 使用原分解前向和 `Recomputed` 名称包装，关闭 recompute，严格校验全部键、形状、dtype、有限值和所属组。不使用 `strict=False` 或猜测 `.module` 替换。
- 基座和冻结 MIDI embedding strict 加载，PAD embedding 必须为零；设备移动不把 FP32 LoRA 因子强制转为 BF16。
- 推理沿用 F 原编码方式：仅编码 A 及其间隔，按原规则作 -6 dB 峰值缩放，不编码 B 作为条件。
- H 保留有效 A/B 的编辑器原始控制序列，gap/rear 填零。MIDI 在 A/gap/rear 使用零 PAD embedding，在 B 内保留真实 REST/pitch 控制。
- BF16 autocast 下计算 encoder、DiT、decoder，FP32 Euler state，`t_shift=0.5`。零 CFG 增益保留完整条件；非零值沿用工作台统一/三路差分公式，无随机条件 dropout。
- 解码 B 与连续生成的尾部上下文，裁掉仅用于解码的尾部。保留双声道 FLOAT WAV，不作额外归一化、限幅或单声道截取。
- 单次与常驻路径使用同一加载器和采样器。切换模型使用独立 runtime，不能递归叠层。

## 验证

- 真正的 3K 检查点合同测试覆盖 420 张量、数量/形状/有限性、步数及 EMA 选择。
- 卷积转置测试验证方向、stride/padding/output_padding 与 weight norm 保留；LoRA B 为零或禁用时返回基座输出。
- 32 步、seed 42、零 CFG 的短样本对照中，工作台 3K 输出与支持包原 `Engine.generate`
  数值完全一致，双声道 `[2, 131072]`，最大绝对差为 0。
- 6K 经常驻加载和短合成验证。显存常驻约 2380 MiB；未完成长歌峰值标定，目录明确显示“保守预算（峰值未标定）”，不可把预算当实测曲线。
- 浏览器临时工程验证 3K/6K 选择、默认 PgO、其他旧选项隐藏、旧工程兼容和没有 CFG 开关；拦截工程写入，不修改用户工程。

主要文件：`server/scripts/f1_runtime.py`、`server/src/services/v5p-preset.ts`、
单次/常驻 runner、模型目录、`client/src/object-workbench/v5pModel.ts`。
