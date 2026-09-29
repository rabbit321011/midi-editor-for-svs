# AISVC-midi-web Updates

本目录记录版本化 design / report checkpoint。

项目状态按追加链条理解：

```text
baseline report
+ ver0.1 report
+ ver0.2 report
+ ver0.3 report
+ ...
= 当前项目整体状态
```

每个 checkpoint 目录可包含：

```text
design.md   本 checkpoint 的设计意图
report.md   checkpoint 收束后生成的现实报告
```

`design.md` 记录意图。`report.md` 记录现实。

如果 checkpoint 尚未实现或尚未收束，可以只有 `design.md`，不需要提前创建空的 `report.md`。

当代码或设计实际收束后，再生成对应版本的 `report.md`，总结实际完成内容、变更文件、验证结果、设计偏差、风险和遗留问题。

起点报告位于：

```text
docs/updates/baseline/report.md
```

## 新增设计

- [ver0.9 SYN 歌词辅助校对设计](ver0.9/design.md)：记录参考歌词服从 Segment 边界、基于实际时间与已确认上下文的宽松匹配，以及不挤占时间线的临时校对交互。首版实现及验证情况见 [ver0.9 落地报告](ver0.9/report.md)。

此目录曾长期未追加 checkpoint；ver0.9 是本次设计记录编号，不表示 ver0.8 至今的所有代码变化已补写，也不替代现有专题文档。设计与实际差异以对应 report.md 为准。
