<template>
  <div class="keymap-page">
    <header class="keymap-head">
      <div>
        <h1>操作与键位教学</h1>
        <p>这页只讲当前可用的真实流程，不讲旧 TextObject 链路。</p>
      </div>
      <nav class="section-nav" aria-label="教学目录">
        <a href="#v5p-workflow">V5-P 流程</a>
        <a href="#v5p-editor">轨道编辑</a>
        <a href="#shortcuts">快捷键</a>
      </nav>
    </header>

    <section id="v5p-workflow" class="guide-section">
      <div class="section-title">
        <span class="section-index">01</span>
        <div>
          <h2>从音频到 V5-P Take</h2>
          <p>所有生成都是显式操作。一次只覆盖一个目标轨，其他轨不动。</p>
        </div>
      </div>

      <div class="workflow">
        <div class="workflow-step">
          <span class="step-number">1</span>
          <div><strong>创建合成单元</strong><p>在左侧资源栏或时间线上的 AudioObject 右键，选择“创建音轨合成单元”。生成的是可独立编辑的 SYN，不是旧 TextObject。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">2</span>
          <div><strong>生成 Segment 和 MIDI-P</strong><p>右键 Guide Audio，分别执行“自动转录为 Segment”和“GAME 自动生成 MIDI-P”。两项互不影响，也不会自动改别的轨。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">3</span>
          <div><strong>校对整句歌词</strong><p>双击 Segment，修正句子文本、Kana、Romaji 和句级边界。Segment 是句单位，右键可继续重提取本句文本。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">4</span>
          <div><strong>逐层生成 Kana 和 H</strong><p>先让 Segment 生成 Kana。Kana 生成后，可以继续走两种 H 路线：`按当前 Kana 边界对齐至 H Token`，或者 `映射至 H Token` 直接按当前 Kana 内容铺开。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">5</span>
          <div><strong>手工调整 token frame</strong><p>H Token 只占单帧；MIDI-P 也按 frame 编辑。H 右键做替换，MIDI-P 头 token 可横向改时序、纵向改音高。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">6</span>
          <div><strong>准备并绑定 A 区参考</strong><p>A 必须是另一个已准备好的合成单元。把它拖进“A 区参考”槽，或点选择按钮绑定；不能直接拿普通 AudioObject 顶上来。</p></div>
        </div>
        <div class="workflow-step">
          <span class="step-number">7</span>
          <div><strong>生成、试听并导出 Take</strong><p>点击 A 区栏末尾的魔棒生成 Take。完成后在 Takes 条切换试听，满意后再导出到正式音轨。</p></div>
        </div>
      </div>

      <div class="preflight-band">
        <strong>魔棒是灰色的？</strong>
        <span>检查 B Guide、B H、B MIDI-P、A 区绑定和 A H。A 不能是自身，也不能直接绑定普通 AudioObject；先把参考音频创建成另一个 SYN。</span>
      </div>
    </section>

    <section id="v5p-editor" class="guide-section">
      <div class="section-title">
        <span class="section-index">02</span>
        <div>
          <h2>合成单元内的鼠标操作</h2>
          <p>同一层里，编辑和生成是分开的；不要指望自动级联。</p>
        </div>
      </div>

      <div class="control-table">
        <div class="control-row header"><span>区域</span><span>操作</span><span>结果</span></div>
        <div class="control-row"><strong>Guide Audio</strong><span>右键</span><p>转录 Segment，或用 GAME 覆盖完整 MIDI-P 轨。</p></div>
        <div class="control-row"><strong>Segment</strong><span>双击 / 拖边界</span><p>编辑原文、Kana、Romaji 和句级 frame。</p></div>
        <div class="control-row"><strong>Segment</strong><span>右键</span><p>只覆盖该句的目标轨范围，不改别的轨。</p></div>
        <div class="control-row"><strong>Kana</strong><span>双击 / 拖主体</span><p>编辑单个 Kana。SEG 也是 Kana 轨上的一个单帧对象。</p></div>
        <div class="control-row"><strong>Kana</strong><span>右键</span><p>可走“自动对齐至 H Token”或“映射至 H Token”。</p></div>
        <div class="control-row"><strong>H Token</strong><span>悬浮 / 左拖</span><p>查看中文说明；将单帧 token 移到另一个离散 frame。</p></div>
        <div class="control-row"><strong>H Token</strong><span>右键 / 双击</span><p>在任意 frame 打开 token 选择器，强制替换或清空。</p></div>
        <div class="control-row"><strong>MIDI-P 头 token</strong><span>左拖</span><p>横向移动时间，纵向每级改变 0.5 半音；FLOW 只是在前端显示上承接前一个音高。</p></div>
        <div class="control-row"><strong>MIDI-P / FLOW</strong><span>右键</span><p>精确输入 class，或显式写入 FLOW、REST。连续同音高 run 只有首帧是实体音高 token。</p></div>
        <div class="control-row"><strong>A 区参考</strong><span>拖入 / 选择</span><p>绑定另一个合成单元的完整 Guide 和最新 Text/H。</p></div>
        <div class="control-row"><strong>Takes</strong><span>点击 / 播放 / 下载</span><p>选择历史结果、切换 Take 试听，或复制到正式 AudioObject/TrackObject。</p></div>
      </div>

      <div class="playback-band">
        <div><strong>Guide</strong><span>听 B 的原始 Owned Guide</span></div>
        <div><strong>MIDI-P</strong><span>听当前 token 轨的钢琴预览</span></div>
        <div><strong>Take</strong><span>听当前选中的 V5-P 合成结果</span></div>
        <p>先在顶部选择播放源，再按 <kbd>Space</kbd>。输入框、弹窗和按钮获得焦点时，空格不会误触播放。</p>
      </div>
    </section>

    <section id="shortcuts" class="guide-section">
      <div class="section-title">
        <span class="section-index">03</span>
        <div>
          <h2>键盘与时间线</h2>
          <p>合成单元和主时间线共用撤销、重做与播放习惯。</p>
        </div>
      </div>

      <section class="keyboard" aria-label="Keyboard shortcuts">
        <div class="key wide">Space<span>当前来源播放 / 暂停</span></div>
        <div class="key wide">Ctrl Z<span>撤销最近一次编辑</span></div>
        <div class="key wide">Ctrl Shift Z<span>重做编辑</span></div>
        <div class="key">N<span>TrackObject</span></div>
        <div class="key">L<span>AudioObject</span></div>
        <div class="key">M<span>MidiObject</span></div>
        <div class="key">K<span>TextObject</span></div>
        <div class="key space">Mouse Wheel<span>时间线滚动与浏览</span></div>
      </section>

      <div class="shortcut-columns">
        <section class="shortcut-list">
          <h3>项目与编辑</h3>
          <div class="shortcut"><div class="key-combo"><kbd>Space</kbd></div><strong>播放 / 暂停当前来源</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>S</kbd></div><strong>保存项目</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>O</kbd></div><strong>导入项目</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>Z</kbd></div><strong>撤销</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>Y</kbd></div><strong>重做</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Z</kbd></div><strong>重做</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>C</kbd></div><strong>复制选中的音频片段或合成单元</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>V</kbd></div><strong>粘贴到新音轨</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>B</kbd></div><strong>合并选中片段</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Delete</kbd></div><strong>删除选中的对象、Kana、H 或 MIDI-P</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Enter</kbd></div><strong>用选中对象创建组</strong></div>
        </section>

        <section class="shortcut-list">
          <h3>浏览与定位</h3>
          <div class="shortcut"><div class="key-combo"><kbd>Alt</kbd><span>+</span><kbd>Wheel</kbd></div><strong>快速横向移动 Timeline</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>Wheel</kbd></div><strong>上下浏览音轨</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>↑</kbd></div><strong>片段上移一条音轨</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>↓</kbd></div><strong>片段下移一条音轨</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Alt</kbd><span>+</span><kbd>N</kbd></div><strong>定位 TrackObject / 合成单元</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Alt</kbd><span>+</span><kbd>L</kbd></div><strong>定位 AudioObject</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Alt</kbd><span>+</span><kbd>M</kbd></div><strong>定位关联 MidiObject</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Alt</kbd><span>+</span><kbd>K</kbd></div><strong>定位关联 TextObject</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Double-click</kbd></div><strong>打开对象或文本句编辑器</strong></div>
          <div class="shortcut"><div class="key-combo"><kbd>Ctrl</kbd><span>+</span><kbd>E</kbd></div><strong>打开完整 TextObject 编辑页</strong></div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.keymap-page {
  flex: 1;
  overflow: auto;
  padding: 24px 28px 48px;
  color: var(--app-text);
  letter-spacing: 0;
}
.keymap-head {
  max-width: 1040px;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--app-border);
}
.keymap-head h1 { margin: 0 0 4px; font-size: 22px; font-weight: 650; }
.keymap-head p,
.section-title p { margin: 0; color: var(--app-muted); font-size: 12px; }
.section-nav { display: flex; gap: 16px; font-size: 12px; }
.section-nav a { color: var(--app-muted); text-decoration: none; }
.section-nav a:hover { color: var(--app-text); }
.guide-section { max-width: 1040px; margin-bottom: 38px; scroll-margin-top: 18px; }
.section-title {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 10px;
  align-items: start;
  margin-bottom: 14px;
}
.section-title h2 { margin: 0 0 4px; font-size: 16px; font-weight: 650; }
.section-index { color: var(--app-accent); font: 12px/22px ui-monospace, SFMono-Regular, Consolas, monospace; }
.workflow { border-top: 1px solid var(--app-border); }
.workflow-step {
  display: grid;
  grid-template-columns: 36px 1fr;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--app-border);
}
.step-number {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid var(--app-accent);
  border-radius: 3px;
  color: var(--app-accent);
  font: 10px ui-monospace, SFMono-Regular, Consolas, monospace;
}
.workflow-step strong { display: block; margin-bottom: 4px; font-size: 13px; }
.workflow-step p,
.control-row p { margin: 0; color: var(--app-muted); font-size: 12px; line-height: 1.55; }
.preflight-band,
.playback-band {
  margin-top: 14px;
  padding: 12px 14px;
  border-left: 3px solid #d2a85b;
  background: color-mix(in srgb, var(--app-panel) 92%, #d2a85b 8%);
}
.preflight-band { display: grid; grid-template-columns: 132px 1fr; gap: 12px; font-size: 12px; line-height: 1.55; }
.preflight-band span { color: var(--app-muted); }
.control-table { border-top: 1px solid var(--app-border); }
.control-row {
  display: grid;
  grid-template-columns: 150px 170px minmax(260px, 1fr);
  gap: 14px;
  align-items: center;
  min-height: 42px;
  border-bottom: 1px solid var(--app-border);
  font-size: 12px;
}
.control-row.header { min-height: 32px; color: var(--app-muted); font-size: 10px; text-transform: uppercase; }
.control-row strong { font-size: 12px; }
.control-row > span { color: var(--app-accent); font: 11px ui-monospace, SFMono-Regular, Consolas, monospace; }
.playback-band {
  display: grid;
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  gap: 12px;
  border-left-color: var(--app-accent);
}
.playback-band div { display: grid; gap: 3px; }
.playback-band div span { color: var(--app-muted); font-size: 11px; }
.playback-band p { grid-column: 1 / -1; margin: 2px 0 0; color: var(--app-muted); font-size: 11px; }
.keyboard {
  display: grid;
  grid-template-columns: repeat(6, minmax(72px, 1fr));
  gap: 8px;
  padding: 16px;
  border: 1px solid var(--app-border);
  background: color-mix(in srgb, var(--app-panel) 88%, transparent);
}
.key {
  min-height: 58px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 8px;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
  font-size: 15px;
  font-weight: 700;
}
.key span { margin-top: 5px; color: var(--app-muted); font-size: 10px; font-weight: 500; }
.key.wide { grid-column: span 2; }
.key.space { grid-column: span 4; }
.shortcut-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px; }
.shortcut-list { display: grid; align-content: start; }
.shortcut-list h3 {
  margin: 0;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--app-border);
  font-size: 13px;
  font-weight: 650;
}
.shortcut {
  display: grid;
  grid-template-columns: 180px 1fr;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  border-bottom: 1px solid var(--app-border);
}
.key-combo { display: flex; align-items: center; gap: 5px; color: var(--app-muted); }
kbd {
  min-width: 30px;
  padding: 4px 7px;
  border: 1px solid var(--app-border);
  border-radius: 4px;
  background: color-mix(in srgb, var(--app-surface) var(--center-opacity-percent), transparent);
  color: var(--app-text);
  font: 11px ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
}
.shortcut strong { font-size: 12px; font-weight: 500; }
@media (max-width: 900px) {
  .keymap-head { align-items: flex-start; flex-direction: column; }
  .shortcut-columns { grid-template-columns: 1fr; }
  .control-row { grid-template-columns: 120px 140px minmax(220px, 1fr); }
}
</style>
