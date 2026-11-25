import React from 'react';
import { api } from '../api.js';

const CHANNELS = [
  { id: 'male', label: '男频' },
  { id: 'female', label: '女频' },
];
const PLATFORMS = [
  { id: 'fanqie', label: '番茄' },
  { id: 'qidian', label: '起点' },
  { id: 'jinjiang', label: '晋江' },
  { id: 'qimao', label: '七猫' },
  { id: 'feilu', label: '飞卢' },
  { id: 'free', label: '自由' },
];
// 各平台常见全书字数目标（与选题详情预设一致），创意阶段据此给默认值
const PLATFORM_TARGET_WORDS = {
  fanqie: 1500000, qidian: 2000000, jinjiang: 600000, qimao: 1500000, feilu: 1000000, free: 500000,
};
const GENRES = {
  male: ['都市', '玄幻', '仙侠', '奇幻', '历史', '军事', '游戏', '科幻', '悬疑', '武侠', '轻小说'],
  female: ['古代言情', '现代言情', '幻想言情', '纯爱', '悬疑推理', '种田', '宫斗', '职场', '年代'],
};
const TAGS = [
  '系统流', '签到', '神豪', '马甲', '重生', '穿越', '升级流',
  '无金手指', '逆袭', '群像', '经营', '种田', '卡牌', '无限流',
  '甜宠', '虐恋', '复仇', '团宠', '慢热', '日常',
];
const OUTLINE_FIELDS = [
  { key: 'background', label: '故事背景', rows: 3, ph: '大背景：世界 / 时代 / 势力格局' },
  { key: 'theme', label: '主旨 / 灵魂', rows: 2, ph: '这本书想告诉读者什么' },
  { key: 'mainline', label: '主线', rows: 3, ph: '主角为达成目标的核心行动链（起因→冲突→目标→驱动力→闭环）' },
  { key: 'branches', label: '支线与副本', rows: 3, ph: '2-4 个副本，各写明「为主线提供什么」' },
  { key: 'hidden', label: '隐藏线（暗线）', rows: 2, ph: '前期埋、后期揭的真相' },
  { key: 'stages', label: '分卷推进', rows: 4, ph: '开局立足 → 成长 → 受挫 → 高潮，每阶段写清核心冲突与爽点' },
  { key: 'timeline', label: '时间轴', rows: 2, ph: '故事总跨度与关键时间节点' },
  { key: 'ending', label: '结局设定', rows: 3, ph: '大结局如何收束、主角最终状态' },
  { key: 'backup', label: '备选预案', rows: 2, ph: '写偏了怎么拉回主线？人物写死了怎么办' },
  { key: 'selling', label: '故事卖点', rows: 2, ph: '与同类相比的差异化与爽点' },
];

/**
 * 报错展示：AI 类错误往往夹带一大段原始输出，直接铺开会糊满屏幕。
 * 这里只显示首行摘要，原始内容折叠，需要排查时再展开/复制。
 */
function ErrBox({ text }) {
  const [open, setOpen] = React.useState(false);
  const raw = String(text || '');
  const lines = raw.split('\n');
  const head = lines[0] || '';
  const rest = lines.slice(1).join('\n').trim();
  return (
    <div className="err cmp-errbox">
      <div className="cmp-errbox-head">
        <span>{head}</span>
        {rest && (
          <button className="link-btn" onClick={() => setOpen(!open)}>
            {open ? '收起原文' : '展开原文'}
          </button>
        )}
      </div>
      {open && rest && (
        <>
          <pre className="cmp-errbox-raw">{rest}</pre>
          <button
            className="link-btn"
            onClick={() => navigator.clipboard?.writeText(raw).catch(() => {})}
          >
            复制完整报错
          </button>
        </>
      )}
    </div>
  );
}

/** 步骤定义：scratch 多一个「创意/书名」起手 */
const STEPS = [
  { key: 'idea', label: '创意 / 书名' },
  { key: 'outline', label: '大纲 & 人物' },
  { key: 'volumes', label: '分卷 & 卷纲' },
  { key: 'chapters', label: '章节目录' },
  { key: 'write', label: '生成细节' },
];

const emptyTopic = () => ({
  title: '', logline: '', protagonist: '', hook: '', channel: 'male', genre: '', platform: 'fanqie', tags: [], audience: '', refWorks: [],
});

export default function ComposeWizard({ mode = 'scratch', work, aiCfg, onClose, onOpenSettings, onDone }) {
  const [cursor, setCursor] = React.useState(mode === 'work' ? 1 : 0); // work 模式跳过 idea
  const [workId, setWorkId] = React.useState(mode === 'work' && work ? work.id : null);
  const [plan, setPlan] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [elapsed, setElapsed] = React.useState(0);
  const timer = React.useRef(null);
  const stopRef = React.useRef(false);

  // idea 步骤本地态
  const [seed, setSeed] = React.useState('');
  const [topicFields, setTopicFields] = React.useState(emptyTopic());
  const [names, setNames] = React.useState([]);
  const [bookName, setBookName] = React.useState('');
  const [targetWords, setTargetWords] = React.useState(PLATFORM_TARGET_WORDS.fanqie);
  const targetWordsTouched = React.useRef(false); // 用户手动改过就不随平台联动

  // 生成细节步骤本地态
  const [scope, setScope] = React.useState('firstVolume');
  const [nLimit, setNLimit] = React.useState(5);
  const [chapterWords, setChapterWords] = React.useState(2000);
  const [planPerVol, setPlanPerVol] = React.useState(25); // 分卷规划：每卷章数（仅用于按目标字数换算卷数）
  const [writing, setWriting] = React.useState(false);
  const [writtenCount, setWrittenCount] = React.useState(0);
  const [totalToWrite, setTotalToWrite] = React.useState(0);
  const [curLabel, setCurLabel] = React.useState('');
  const [done, setDone] = React.useState(false);
  const [batchGen, setBatchGen] = React.useState(false); // 是否正在批量生成章纲（用于显示停止按钮）

  React.useEffect(() => {
    (async () => {
      if (mode === 'work' && work) {
        try {
          const r = await api.composeStart(work.id);
          setPlan(r.plan);
        } catch (e) {
          setErr(e.message || '初始化失败');
        }
      }
    })();
    return () => clearInterval(timer.current);
  }, []);

  function startTimer() {
    setElapsed(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }
  const aiReady = aiCfg?.configured || aiCfg?.ready;

  /* ---------------- idea 步骤（scratch） ---------------- */
  async function genTopic() {
    if (!seed.trim()) return setErr('先写一句话创意');
    setBusy(true);
    setErr('');
    try {
      const t = await api.aiTopic({ seed: seed.trim(), channel: topicFields.channel, platform: topicFields.platform, mode: 'new' });
      setTopicFields((f) => ({ ...f, ...t, channel: topicFields.channel, platform: topicFields.platform }));
      const r = await api.aiNames({ topic: { ...topicFields, ...t } }).catch(() => ({ names: [] }));
      setNames(r.names || []);
      if (t.title && !bookName) setBookName(t.title);
    } catch (e) {
      setErr(e.message || '生成失败');
    } finally {
      setBusy(false);
    }
  }

  async function createAndNext() {
    if (!bookName.trim()) return setErr('请填写书名');
    setBusy(true);
    setErr('');
    try {
      const t = await api.createTopic({ ...topicFields, plan: { targetWords: Number(targetWords) || 1000000 } });
      const w = await api.createWork({ title: bookName.trim(), topicId: t.id });
      setWorkId(w.id);
      const r = await api.composeStart(w.id);
      setPlan(r.plan);
      setCursor(1);
    } catch (e) {
      setErr(e.message || '创建失败');
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- 大纲 & 人物 ---------------- */
  async function genOutline() {
    if (!workId) return setErr('请先完成上一步');
    setBusy(true);
    setErr('');
    try {
      const r = await api.composeStep(workId, 'outline');
      setPlan(r.plan);
      setMsg('已生成大纲与人物，可直接修改后再往下');
    } catch (e) {
      setErr(e.message || '生成失败');
    } finally {
      setBusy(false);
    }
  }

  function updateOutline(key, val) {
    setPlan((p) => (p ? { ...p, outline: { ...p.outline, [key]: val } } : p));
  }
  function updateChar(i, key, val) {
    setPlan((p) => {
      if (!p) return p;
      const chars = p.chars.map((c, k) => (k === i ? { ...c, [key]: val } : c));
      return { ...p, chars };
    });
  }
  function addChar() {
    setPlan((p) => (p ? { ...p, chars: [...(p.chars || []), emptyTopic()] } : p));
  }
  function removeChar(i) {
    setPlan((p) => (p ? { ...p, chars: (p.chars || []).filter((_, k) => k !== i) } : p));
  }

  /* ---------------- 分卷 ---------------- */
  async function genVolumes() {
    if (!workId) return setErr('请先完成上一步');
    setBusy(true);
    setErr('');
    try {
      const r = await api.composeStep(workId, 'volumes', { targetVolumes: 3 });
      setPlan(r.plan);
      const r2 = await api.composeSyncVolumes(workId);
      setPlan(r2.plan);
      setMsg('已生成分卷，并同步成作品里的真实卷（可改卷名/章数）');
    } catch (e) {
      setErr(e.message || '生成失败');
    } finally {
      setBusy(false);
    }
  }
  function updateVolume(i, key, val) {
    setPlan((p) => {
      if (!p) return p;
      const volumes = p.volumes.map((v, k) => (k === i ? { ...v, [key]: val } : v));
      return { ...p, volumes };
    });
  }
  /**
   * 按「全书目标字数」反推卷数 / 每卷章数：
   * totalChapters = ceil(targetWords / 每章字数)；volumes = ceil(totalChapters / 每卷章数)。
   * 先让后端按 volumes 生成卷内容，再按余数把章数平摊到各卷并持久化。
   * 注意：每章字数仅用于估算章数，实际正文长度由「生成细节」的 chapterWords 决定。
   */
  async function autoPlanVolumes() {
    const bookTarget = work?.targetWords || Number(targetWords) || 0;
    if (!bookTarget) return setErr('先设置全书目标字数（在「创意 / 书名」步骤）');
    if (!workId) return setErr('请先完成上一步');
    setBusy(true);
    setErr('');
    try {
      const Y = Math.max(800, Math.min(4000, Number(chapterWords) || 2000));
      const M = Math.max(5, Math.min(60, Number(planPerVol) || 25));
      const totalChapters = Math.max(1, Math.ceil(bookTarget / Y));
      const wantVolumes = Math.max(2, Math.min(40, Math.ceil(totalChapters / M)));
      const r = await api.composeStep(workId, 'volumes', { targetVolumes: wantVolumes });
      const actualVols = r.plan.volumes.length || wantVolumes; // 以实际生成的卷数为准，避免 AI 少生成导致分配错位
      const base = Math.floor(totalChapters / actualVols);
      const rem = totalChapters - base * actualVols;
      const dist = r.plan.volumes.map((v, i) => ({ ...v, chaptersPerVolume: base + (i < rem ? 1 : 0) }));
      setPlan((p) => ({ ...p, volumes: dist }));
      await api.composeSave(workId, { volumes: dist });
      setChapterWords(Y); // 让「生成细节」的每章字数默认值与规划假设一致
      setMsg(`已按目标规划：${actualVols} 卷 / 约 ${totalChapters} 章（每章约 ${Y} 字，实际生成字数在「生成细节」设置）`);
    } catch (e) {
      setErr(e.message || '规划失败');
    } finally {
      setBusy(false);
    }
  }

  function addVolumeLocal() {
    setPlan((p) => {
      if (!p) return p;
      const idx = p.volumes.length;
      return {
        ...p,
        volumes: [
          ...p.volumes,
          { id: `local-${Date.now()}`, index: idx, title: `第${idx + 1}卷`, summary: '', goal: '', keyEvents: [], conflict: '', endState: '', tone: '', chaptersPerVolume: 15, workVolumeId: null, chapters: [] },
        ],
      };
    });
  }
  function removeVolume(i) {
    setPlan((p) => (p ? { ...p, volumes: p.volumes.filter((_, k) => k !== i) } : p));
  }

  /* ---------------- 章节目录 ---------------- */
  async function genChapters(vol) {
    if (!workId) return setErr('请先完成上一步');
    setBusy(true);
    setErr('');
    try {
      const r = await api.composeStep(workId, 'chapters', { volumeId: vol.id, chaptersPerVolume: vol.chaptersPerVolume || 15 });
      setPlan(r.plan);
    } catch (e) {
      setErr(e.message || '生成失败');
    } finally {
      setBusy(false);
    }
  }
  /**
   * 一键生成所有章纲：只补「还没有章纲」的卷，已生成的卷不会覆盖（避免丢失手动编辑）。
   * 逐卷调用后端，每卷结束刷新进度；支持中途停止。
   */
  async function genAllChapters() {
    if (!workId) return setErr('请先完成上一步');
    const todo = (plan.volumes || []).filter((v) => !v.chapters?.length);
    if (!todo.length) return setMsg('所有卷都已生成章纲（如需重做，点各卷「重新生成章纲」）');
    const total = todo.length;
    const totalChapters = todo.reduce((n, v) => n + (v.chaptersPerVolume || 15), 0);
    setBusy(true);
    setBatchGen(true);
    setStop(false);
    setErr('');
    setMsg(`正在生成 ${total} 卷 / 约 ${totalChapters} 章的章纲（每卷分批，可能需数分钟）…`);
    try {
      let doneN = 0;
      for (const v of todo) {
        if (stopRef.current) break;
        const r = await api.composeStep(workId, 'chapters', { volumeId: v.id, chaptersPerVolume: v.chaptersPerVolume || 15 });
        setPlan(r.plan);
        doneN += 1;
        setMsg(`已生成 ${doneN}/${total} 卷章纲…（可随时停止）`);
      }
      setMsg(
        stopRef.current
          ? `已停止：完成 ${doneN}/${total} 卷，已生成的已保存，可再次点「一键生成所有章纲」补剩余`
          : `已完成：全部 ${plan.volumes.length} 卷章纲已生成（共约 ${totalChapters} 章）`
      );
    } catch (e) {
      setErr(e.message || '生成失败（已生成的卷已保存，可再次点击补剩余）');
    } finally {
      setBusy(false);
      setBatchGen(false);
    }
  }
  function updateChapter(vi, ci, key, val) {
    setPlan((p) => {
      if (!p) return p;
      const volumes = p.volumes.map((v, k) =>
        k === vi ? { ...v, chapters: v.chapters.map((c, j) => (j === ci ? { ...c, [key]: val } : c)) } : v
      );
      return { ...p, volumes };
    });
  }

  /* ---------------- 生成细节 ---------------- */
  function buildTarget() {
    const all = [];
    (plan.volumes || []).forEach((v) => (v.chapters || []).forEach((c) => {
      if (!c.written) all.push({ v, c });
    }));
    if (scope === 'firstVolume') return all.filter((x) => x.v.index === 0);
    if (scope === 'firstN') return all.slice(0, Math.max(1, Number(nLimit) || 5));
    return all; // all
  }

  async function writeChapters() {
    if (!workId) return setErr('请先完成上一步');
    const target = buildTarget();
    if (!target.length) return setErr('没有需要生成的章节（可能都已写完）');
    setWriting(true);
    setStop(false);
    setDone(false);
    setErr('');
    setWrittenCount(0);
    setTotalToWrite(target.length);
    setMsg('');
    startTimer();
    try {
      // 写之前确保卷已同步到作品
      if (target.some((x) => !x.v.workVolumeId)) {
        const r = await api.composeSyncVolumes(workId);
        setPlan(r.plan);
      }
      for (let i = 0; i < target.length; i += 1) {
        if (stopRef.current) break;
        const { v, c } = target[i];
        setCurLabel(`正在写：${v.title} · ${c.title || `第${c.index + 1}章`}`);
        const r = await api.composeChapter(workId, { volumeId: v.id, planChapterId: c.id, words: chapterWords });
        setPlan((p) => {
          const np = JSON.parse(JSON.stringify(p));
          const pv = np.volumes.find((x) => x.id === v.id);
          const pc = pv?.chapters.find((x) => x.id === c.id);
          if (pc) {
            pc.written = true;
            pc.chapterId = r.chapter.id;
            pc.title = pc.title || r.title;
          }
          return np;
        });
        setWrittenCount(i + 1);
      }
    } catch (e) {
      setErr(e.message || '生成失败（已写部分已保存，可继续生成剩余）');
    } finally {
      clearInterval(timer.current);
      setWriting(false);
      setCurLabel('');
      const rp = await api.composePlan(workId).catch(() => null);
      if (rp?.plan) setPlan(rp.plan);
      setDone(true);
    }
  }
  function setStop(v) {
    stopRef.current = v;
  }

  /* ---------------- 步骤导航 ---------------- */
  async function goNext() {
    setErr('');
    setMsg('');
    if (cursor >= STEPS.length - 1) return;
    // 离开大纲/分卷/章节步骤时，把本地编辑持久化回计划
    if (plan && workId) {
      try {
        await api.composeSave(workId, { outline: plan.outline, chars: plan.chars, volumes: plan.volumes });
      } catch {}
    }
    setCursor((c) => c + 1);
  }
  function goPrev() {
    if (cursor > 0) setCursor((c) => c - 1);
  }

  const step = STEPS[cursor];
  const pct = totalToWrite ? Math.round((writtenCount / totalToWrite) * 100) : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide compose" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>一键成书 · 流水线</b>
          <span className="compose-sub">书名/创意 → 大纲/世界观 → 分卷/详纲 → 章节目录 → 每章细节</span>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        {/* 步骤条 */}
        <div className="compose-steps">
          {STEPS.map((s, i) => (
            <div key={s.key} className={`cstep ${i === cursor ? 'on' : ''} ${i < cursor ? 'done' : ''}`}>
              <span className="cstep-no">{i + 1}</span>
              <span className="cstep-label">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="modal-body">
          {!aiReady && (
            <p className="err">
              AI 未配置，生成类按钮不可用。
              <button className="link-btn" onClick={onOpenSettings}>
                去 AI 设置
              </button>
            </p>
          )}
          {err && <ErrBox text={err} />}
          {msg && <p className="ai-state ok">{msg}</p>}
          {busy && <p className="hint">本地模型生成中，别关窗口… {elapsed}s</p>}

          {/* ===== 步骤 0：创意 / 书名 ===== */}
          {step.key === 'idea' && (
            <div className="cmp-idea">
              <p className="hint">空手起书：写一句话创意（谁，陷在什么处境里，靠什么翻身），让 AI 帮你定选题、起书名；也可以直接填书名。</p>
              <textarea
                className="inp"
                rows={3}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="一句话创意：例如 一个被全网嘲讽的废物，每天签到都能拿到一件神级物品"
              />
              <div className="fc-bar">
                <label>
                  频道
                  <select value={topicFields.channel} onChange={(e) => setTopicFields((f) => ({ ...f, channel: e.target.value }))}>
                    {CHANNELS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  平台
                  <select
                    value={topicFields.platform}
                    onChange={(e) => {
                      const pf = e.target.value;
                      setTopicFields((f) => ({ ...f, platform: pf }));
                      if (!targetWordsTouched.current) setTargetWords(PLATFORM_TARGET_WORDS[pf] || 1000000);
                    }}
                  >
                    {PLATFORMS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cmp-target">
                  全书目标字数
                  <input
                    className="inp num"
                    type="number"
                    min={50000}
                    max={10000000}
                    step={50000}
                    value={targetWords}
                    onChange={(e) => {
                      targetWordsTouched.current = true;
                      setTargetWords(Math.max(50000, Math.min(10000000, Number(e.target.value) || 1000000)));
                    }}
                  />
                </label>
                <button className="btn" disabled={busy || !aiReady} onClick={genTopic}>
                  {busy ? `生成中… ${elapsed}s` : 'AI 生成选题'}
                </button>
              </div>

              {(topicFields.logline || topicFields.title) && (
                <div className="cmp-fields">
                  <Field label="选题代号" value={topicFields.title} onChange={(v) => setTopicFields((f) => ({ ...f, title: v }))} />
                  <Field label="一句话创意" value={topicFields.logline} onChange={(v) => setTopicFields((f) => ({ ...f, logline: v }))} />
                  <Field label="主角一句话" value={topicFields.protagonist} onChange={(v) => setTopicFields((f) => ({ ...f, protagonist: v }))} />
                  <Field label="黄金三章钩子" value={topicFields.hook} onChange={(v) => setTopicFields((f) => ({ ...f, hook: v }))} rows={2} />
                  <label className="cmp-genre">
                    题材
                    <select value={topicFields.genre} onChange={(e) => setTopicFields((f) => ({ ...f, genre: e.target.value }))}>
                      <option value="">（未定）</option>
                      {GENRES[topicFields.channel].map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="cmp-tags">
                    {TAGS.map((t) => (
                      <button
                        key={t}
                        className={`chip ${topicFields.tags.includes(t) ? 'on' : ''}`}
                        onClick={() =>
                          setTopicFields((f) => ({
                            ...f,
                            tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t],
                          }))
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="cmp-bookname">
                <label>书名</label>
                <input className="inp" value={bookName} onChange={(e) => setBookName(e.target.value)} placeholder="填写或选一个书名" />
                {!!names.length && (
                  <div className="cmp-names">
                    候选：
                    {names.map((n, i) => (
                      <button key={i} className={`chip ${bookName === n ? 'on' : ''}`} onClick={() => setBookName(n)}>
                        {n}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="ai-actions">
                <button className="btn primary" disabled={busy || writing} onClick={createAndNext}>
                  {busy ? '创建中…' : '生成大纲 →'}
                </button>
                <span className="spacer" />
                <button className="link-btn" onClick={onClose}>
                  关闭
                </button>
              </div>
            </div>
          )}

          {/* ===== 步骤 1：大纲 & 人物 ===== */}
          {step.key === 'outline' && plan && (
            <div className="cmp-outline">
              {!plan.outline ? (
                <div className="cmp-empty">
                  <p className="hint">还没有大纲。让 AI 按「总纲」结构起草故事背景/主线/分卷/结局/人物，或你自己填。</p>
                  <button className="btn primary" disabled={busy || !aiReady} onClick={genOutline}>
                    {busy ? `生成中… ${elapsed}s` : 'AI 生成大纲 & 人物'}
                  </button>
                </div>
              ) : (
                <>
                  <details className="craft-tip" open>
                    <summary>写作锦囊：三层大纲 & 节奏</summary>
                    <ul>
                      <li><b>三层大纲</b>：总纲（全局主线/结局）→ 分卷（卷纲）→ 章纲（每章剧情），逐层细化不跑偏。</li>
                      <li><b>节奏铁律</b>：3 章一小爽、10 章一大爽；爽完缓一缓再继续，只虐不点炸读者会跑。</li>
                      <li><b>正文万能公式</b>：抛矛盾 → 拉仇恨 → 主角出手 → 全场震惊 → 留钩子。</li>
                      <li><b>展示代替告知</b>：别写「他很生气」，写「他指节泛白，茶杯被捏得变形」。</li>
                    </ul>
                  </details>
                  <div className="cmp-grid">
                    {OUTLINE_FIELDS.map((f) => (
                      <div key={f.key} className={`cf ${f.key === 'stages' || f.key === 'mainline' ? 'cf-wide' : ''}`}>
                        <label>{f.label}</label>
                        <textarea
                          className="inp"
                          rows={f.rows}
                          value={plan.outline[f.key] || ''}
                          placeholder={f.ph}
                          onChange={(e) => updateOutline(f.key, e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                  <h4>人物小传</h4>
                  <div className="cmp-chars">
                    {(plan.chars || []).map((c, i) => (
                      <div key={i} className="cmp-char">
                        <div className="cmp-char-head">
                          <input className="inp" value={c.name || ''} placeholder="姓名" onChange={(e) => updateChar(i, 'name', e.target.value)} />
                          <select value={c.role || c.camp || '主角'} onChange={(e) => updateChar(i, 'role', e.target.value)}>
                            {['主角', '重要配角', '反派', '普通配角', '龙套'].map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <button className="icon-btn danger" onClick={() => removeChar(i)} title="删除">
                            ×
                          </button>
                        </div>
                        <textarea className="inp" rows={2} value={c.personality || ''} placeholder="性格" onChange={(e) => updateChar(i, 'personality', e.target.value)} />
                        <div className="cmp-char-2">
                          <input className="inp" value={c.goal || ''} placeholder="表面目标" onChange={(e) => updateChar(i, 'goal', e.target.value)} />
                          <input className="inp" value={c.flaw || ''} placeholder="缺陷/弱点" onChange={(e) => updateChar(i, 'flaw', e.target.value)} />
                        </div>
                        <textarea className="inp" rows={2} value={c.arc || ''} placeholder="成长弧光（结尾与开头不同）" onChange={(e) => updateChar(i, 'arc', e.target.value)} />
                      </div>
                    ))}
                  </div>
                  <div className="ai-actions">
                    <button className="btn" disabled={busy || !aiReady} onClick={genOutline}>
                      重新生成大纲 & 人物
                    </button>
                    <button className="btn" onClick={addChar}>
                      + 加人物
                    </button>
                    <span className="spacer" />
                    <button className="link-btn" onClick={goPrev}>
                      ‹ 上一步
                    </button>
                    <button className="btn primary" disabled={busy} onClick={goNext}>
                      下一步：分卷 →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== 步骤 2：分卷 & 卷纲 ===== */}
          {step.key === 'volumes' && plan && (
            <div className="cmp-volumes">
              {(() => {
                const bookTarget = work?.targetWords || Number(targetWords) || 0;
                const Y = Math.max(800, Math.min(4000, Number(chapterWords) || 2000));
                const M = Math.max(5, Math.min(60, Number(planPerVol) || 25));
                const totalChapters = bookTarget ? Math.max(1, Math.ceil(bookTarget / Y)) : 0;
                const suggestedVolumes = bookTarget ? Math.max(2, Math.min(40, Math.ceil(totalChapters / M))) : 0;
                return (
                  <div className="cmp-planbox">
                    <p className="hint">
                      按「全书目标字数」反推卷数 / 章数（每章字数仅用于估算章数，实际正文长度在「生成细节」设置）。
                    </p>
                    <div className="cmp-plan-row">
                      <label>
                        每章字数
                        <input
                          className="inp num"
                          type="number"
                          min={800}
                          max={4000}
                          step={100}
                          value={chapterWords}
                          onChange={(e) => setChapterWords(Math.max(800, Math.min(4000, Number(e.target.value) || 2000)))}
                        />
                      </label>
                      <label>
                        每卷章数
                        <input
                          className="inp num"
                          type="number"
                          min={5}
                          max={60}
                          value={planPerVol}
                          onChange={(e) => setPlanPerVol(Math.max(5, Math.min(60, Number(e.target.value) || 25)))}
                        />
                      </label>
                      <span className="cmp-plan-calc">
                        {bookTarget ? `约 ${totalChapters} 章 → 建议 ${suggestedVolumes} 卷` : '未设全书目标字数'}
                      </span>
                      <button className="btn" disabled={busy || !aiReady || !bookTarget} onClick={autoPlanVolumes}>
                        {busy ? `规划中… ${elapsed}s` : '按目标规划'}
                      </button>
                    </div>
                  </div>
                );
              })()}
              {!plan.volumes || !plan.volumes.length ? (
                <div className="cmp-empty">
                  <p className="hint">把总纲拆成若干卷（卷纲）。AI 按「分卷推进」阶段 + 升级流循环结构生成，每卷舞台/对手递进。</p>
                  <button className="btn primary" disabled={busy || !aiReady} onClick={genVolumes}>
                    {busy ? `生成中… ${elapsed}s` : 'AI 生成分卷'}
                  </button>
                </div>
              ) : (
                <>
                  <p className="hint">每卷已同步成作品里的真实卷。可改卷名、卷纲、建议章数，也能加/删卷。</p>
                  <div className="cmp-vol-list">
                    {plan.volumes.map((v, i) => (
                      <div key={v.id || i} className="cmp-vol">
                        <div className="cmp-vol-head">
                          <input className="inp" value={v.title || ''} onChange={(e) => updateVolume(i, 'title', e.target.value)} placeholder="卷名" />
                          <label>
                            建议章数
                            <input className="inp num" type="number" min={3} max={40} value={v.chaptersPerVolume || 15} onChange={(e) => updateVolume(i, 'chaptersPerVolume', Number(e.target.value) || 15)} />
                          </label>
                          <button className="icon-btn danger" onClick={() => removeVolume(i)} title="删除卷">
                            ×
                          </button>
                        </div>
                        <textarea className="inp" rows={2} value={v.summary || ''} placeholder="卷纲（本卷走向）" onChange={(e) => updateVolume(i, 'summary', e.target.value)} />
                        <div className="cmp-vol-2">
                          <input className="inp" value={v.goal || ''} placeholder="本卷主角目标" onChange={(e) => updateVolume(i, 'goal', e.target.value)} />
                          <input className="inp" value={v.conflict || ''} placeholder="本卷主要冲突" onChange={(e) => updateVolume(i, 'conflict', e.target.value)} />
                        </div>
                        <div className="cmp-vol-2">
                          <input className="inp" value={v.endState || ''} placeholder="卷末角色状态变化" onChange={(e) => updateVolume(i, 'endState', e.target.value)} />
                          <input className="inp" value={v.tone || ''} placeholder="本卷基调" onChange={(e) => updateVolume(i, 'tone', e.target.value)} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="ai-actions">
                    <button className="btn" disabled={busy || !aiReady} onClick={genVolumes}>
                      重新生成分卷
                    </button>
                    <button className="btn" onClick={addVolumeLocal}>
                      + 加卷
                    </button>
                    <button className="btn" disabled={busy} onClick={() => api.composeSyncVolumes(workId).then((r) => setPlan(r.plan)).catch((e) => setErr(e.message))}>
                      同步到作品卷
                    </button>
                    <span className="spacer" />
                    <button className="link-btn" onClick={goPrev}>
                      ‹ 上一步
                    </button>
                    <button className="btn primary" disabled={busy} onClick={goNext}>
                      下一步：章节目录 →
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ===== 步骤 3：章节目录 ===== */}
          {step.key === 'chapters' && plan && (
            <div className="cmp-chapters">
              {(!plan.volumes || !plan.volumes.length) && <p className="hint">先生成分卷。</p>}
              <div className="cmp-batch-bar">
                <button
                  className="btn primary"
                  disabled={busy || !aiReady || !(plan.volumes || []).some((v) => !v.chapters?.length)}
                  onClick={genAllChapters}
                >
                  {busy ? `生成中… ${elapsed}s` : '一键生成所有章纲'}
                </button>
                <span className="hint cmp-batch-note">
                  {(plan.volumes || []).filter((v) => !v.chapters?.length).length
                    ? `还有 ${(plan.volumes || []).filter((v) => !v.chapters?.length).length} 卷未生成（已生成的不会覆盖）`
                    : '所有卷都已生成章纲'}
                </span>
                {batchGen && (
                  <button className="btn danger" onClick={() => setStop(true)}>
                    停止
                  </button>
                )}
              </div>
              {plan.volumes?.map((v, vi) => (
                <div key={v.id || vi} className="cmp-vol-ch">
                  <div className="cmp-vol-ch-head">
                    <b>{v.title || `第${vi + 1}卷`}</b>
                    <span className="hint">
                      章纲 {v.chapters?.length || 0} 章
                      {v.chapters?.length && v.chaptersPerVolume && v.chapters.length < v.chaptersPerVolume
                        ? `（目标 ${v.chaptersPerVolume} 章，未生成完）`
                        : ''}
                      {v.chapters?.length ? ` · 正文已写 ${v.chapters.filter((c) => c.written).length} 章` : ''}
                    </span>
                    <button className="btn small" disabled={busy || !aiReady} onClick={() => genChapters(v)}>
                      {v.chapters?.length ? '重新生成章纲' : '生成本卷章纲'}
                    </button>
                  </div>
                  {v.chapters?.length ? (
                    <div className="cmp-ch-list">
                      {v.chapters.map((c, ci) => (
                        <div key={c.id || ci} className={`cmp-ch ${c.written ? 'written' : ''}`}>
                          <div className="cmp-ch-head">
                            <span className="cmp-ch-no">第{ci + 1}章</span>
                            <input className="inp" value={c.title || ''} placeholder="正题名" onChange={(e) => updateChapter(vi, ci, 'title', e.target.value)} />
                            {c.written && <span className="ok-tag">已写</span>}
                          </div>
                          <textarea className="inp" rows={2} value={c.plot || ''} placeholder="本章大概剧情（开场/关键动作/结尾钩子）" onChange={(e) => updateChapter(vi, ci, 'plot', e.target.value)} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="hint empty-hint">
                      点「生成本卷章纲」生成 {v.chaptersPerVolume || 15} 章的目录与剧情。
                      {(v.chaptersPerVolume || 15) > 6 &&
                        ` 章数较多，会分批生成（每批 6 章），约需 ${Math.max(1, Math.round((v.chaptersPerVolume || 15) / 6) * 20)}~${Math.max(1, Math.round((v.chaptersPerVolume || 15) / 6) * 40)} 秒，请勿关闭窗口。`}
                    </p>
                  )}
                </div>
              ))}
              <div className="ai-actions">
                <span className="spacer" />
                <button className="link-btn" onClick={goPrev}>
                  ‹ 上一步
                </button>
                <button className="btn primary" disabled={busy} onClick={goNext}>
                  下一步：生成细节 →
                </button>
              </div>
            </div>
          )}

          {/* ===== 步骤 4：生成细节 ===== */}
          {step.key === 'write' && plan && (
            <div className="cmp-write">
              <p className="hint">
                按章纲逐章生成正文并写进作品。本地模型一次写一章较慢，建议分批：先写第一卷或前几章，之后可随时回来续写剩余。
              </p>
              {(() => {
                const bookTarget = (work?.targetWords || Number(targetWords) || 0);
                return bookTarget ? (
                  <p className="cmp-target-note">
                    全书目标字数：<b>{Math.round(bookTarget / 10000)} 万字</b>（首页会按已写字数自动出进度）
                  </p>
                ) : null;
              })()}
              <div className="cmp-scope">
                <label className={scope === 'firstVolume' ? 'on' : ''}>
                  <input type="radio" name="scope" checked={scope === 'firstVolume'} onChange={() => setScope('firstVolume')} />
                  仅第一卷（{plan.volumes?.[0]?.chapters?.length || 0} 章）
                </label>
                <label className={scope === 'firstN' ? 'on' : ''}>
                  <input type="radio" name="scope" checked={scope === 'firstN'} onChange={() => setScope('firstN')} />
                  前
                  <input className="inp num" type="number" min={1} max={60} value={nLimit} onChange={(e) => setNLimit(Number(e.target.value) || 5)} />
                  章
                </label>
                <label className={scope === 'all' ? 'on' : ''}>
                  <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                  全部未写（{plan.volumes.reduce((n, v) => n + (v.chapters || []).filter((c) => !c.written).length, 0)} 章）
                </label>
                <label className="cmp-words">
                  每章目标字数
                  <input
                    className="inp num"
                    type="number"
                    min={400}
                    max={4000}
                    step={100}
                    value={chapterWords}
                    onChange={(e) => setChapterWords(Math.max(400, Math.min(4000, Number(e.target.value) || 2000)))}
                  />
                </label>
              </div>

              {writing ? (
                <div className="cmp-progress">
                  <div className="cmp-prog-bar">
                    <b style={{ width: `${pct}%` }} />
                  </div>
                  <p className="hint">
                    已写 {writtenCount}/{totalToWrite} · {elapsed}s
                  </p>
                  <p className="cur">{curLabel}</p>
                  <button className="btn danger" onClick={() => setStop(true)}>
                    停止
                  </button>
                </div>
              ) : (
                <div className="ai-actions">
                  <button className="btn primary" disabled={busy || !aiReady} onClick={writeChapters}>
                    开始生成
                  </button>
                  {done && (
                    <button className="btn" onClick={() => onDone && onDone(workId)}>
                      打开作品概览
                    </button>
                  )}
                  <span className="spacer" />
                  <button className="link-btn" onClick={goPrev}>
                    ‹ 上一步
                  </button>
                  <button className="link-btn" onClick={onClose}>
                    关闭
                  </button>
                </div>
              )}
              {done && (
                <p className="ai-state ok">
                  已写入作品。可关闭后在左侧分卷里继续「生成细节」补写剩余章节；本章正文可在编辑器里再改。
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, rows = 1 }) {
  return (
    <label className="cmp-field">
      {label}
      {rows > 1 ? (
        <textarea className="inp" rows={rows} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="inp" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
