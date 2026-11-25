import React from 'react';
import { api, countWords } from './api.js';
import Home from './components/Home.jsx';
import TopicDetail from './components/TopicDetail.jsx';
import TopicBrief from './components/TopicBrief.jsx';
import ChapterTree from './components/ChapterTree.jsx';
import Editor from './components/Editor.jsx';
import SidePanel from './components/SidePanel.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import AiSettings from './components/AiSettings.jsx';
import AiContinuePanel from './components/AiContinuePanel.jsx';
import ReviewPanel from './components/ReviewPanel.jsx';
import FirstChapters from './components/FirstChapters.jsx';
import SelfCheckPanel from './components/SelfCheckPanel.jsx';
import WorkOverview from './components/WorkOverview.jsx';
import TopicAi from './components/TopicAi.jsx';
import ComposeWizard from './components/ComposeWizard.jsx';
import { aiRatioOf, platformThreshold } from './lib/aiSpans.js';

const SAVE_DELAY = 2000;        // 停止输入 2s 后保存
const SNAPSHOT_INTERVAL = 600000; // 每 10 分钟留一个快照

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 今日进度：用「今天打开时的总字数」作基线，跨天自动重置 */
function readToday(total) {
  try {
    const raw = JSON.parse(localStorage.getItem('inkdraft.today') || 'null');
    const key = todayKey();
    if (!raw || raw.key !== key) {
      const next = { key, base: total };
      localStorage.setItem('inkdraft.today', JSON.stringify(next));
      return { ...next, gained: 0 };
    }
    return { ...raw, gained: Math.max(0, total - raw.base) };
  } catch {
    return { key: todayKey(), base: total, gained: 0 };
  }
}

/** 顶栏下拉菜单：点击开合，点外部关闭。items: {label,tip,onClick,disabled} | {sep} | {hint} */
function TopMenu({ label, items }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="topmenu" ref={ref}>
      <button className={`btn ${open ? 'on' : ''}`} onClick={() => setOpen((o) => !o)}>
        {label} <i className="tm-caret">▾</i>
      </button>
      {open && (
        <div className="topmenu-pop">
          {items.map((it, i) =>
            it.sep ? (
              <div key={i} className="tm-sep" />
            ) : it.hint ? (
              <div key={i} className="tm-hint">{it.hint}</div>
            ) : (
              <button
                key={i}
                className="tm-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span>{it.label}</span>
                {!!it.tip && <em>{it.tip}</em>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [view, setView] = React.useState('home');   // home | topic | work
  const [topics, setTopics] = React.useState([]);
  const [topicId, setTopicId] = React.useState(null);
  const [topicBack, setTopicBack] = React.useState('home'); // 从哪儿进的选题详情
  const [works, setWorks] = React.useState([]);
  const [work, setWork] = React.useState(null);
  const [chapterId, setChapterId] = React.useState(null);
  const [doc, setDoc] = React.useState(null);
  const [text, setText] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [saveState, setSaveState] = React.useState('saved');
  const [focus, setFocus] = React.useState(false);
  const [panel, setPanel] = React.useState(null); // null | snapshot | topic
  const [snapshots, setSnapshots] = React.useState([]);
  const [meta, setMeta] = React.useState({ dailyGoal: 4000 });
  const [gitOk, setGitOk] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [settings, setSettings] = React.useState({ characters: [], world: [], outline: [] });
  const [modal, setModal] = React.useState(null); // null | 'ai' | 'selfcheck' | 'ai-config' | 'topic-ai'
  const [compose, setCompose] = React.useState(null); // null | { mode:'scratch'|'work', workId }
  const [topicAiMode, setTopicAiMode] = React.useState('create'); // 'create' | 'fill'
  const [aiCfg, setAiCfg] = React.useState({ configured: false, source: 'none', base: '', model: '', keyMask: null });
  const [imgCfg, setImgCfg] = React.useState({ enabled: false, configured: false, hasKey: false, keyMask: null, base: '', model: '' });
  const [nextBusy, setNextBusy] = React.useState(false);
  const [nextMsg, setNextMsg] = React.useState('');
  const [copyTip, setCopyTip] = React.useState('');
  const editorRef = React.useRef(null);

  const dirtyRef = React.useRef(false);
  const timerRef = React.useRef(null);
  const snapshotTimerRef = React.useRef(null);
  const stateRef = React.useRef({ work, chapterId, doc, text, title });

  stateRef.current = { work, chapterId, doc, text, title };

  const refreshTopics = React.useCallback(async () => {
    const r = await api.listTopics();
    setTopics(r.topics);
    return r.topics;
  }, []);

  /* ---------------- 初始化 ---------------- */
  React.useEffect(() => {
    (async () => {
      const [w, m, g, ai, img] = await Promise.all([
        api.listWorks(),
        api.meta(),
        api.gitStatus(),
        api.aiConfig().catch(() => ({ configured: false, source: 'none', base: '', model: '', keyMask: null })),
        api.imageConfig().catch(() => ({ enabled: false, configured: false, hasKey: false, keyMask: null, base: '', model: '' })),
      ]);
      setWorks(w);
      setMeta(m.meta);
      setGitOk(g.available);
      setAiCfg(ai);
      setImgCfg(img);
      await refreshTopics();
      setLoading(false);
    })();
  }, [refreshTopics]);

  /* ---------------- 保存 ---------------- */
  const doSave = React.useCallback(async (opts = {}) => {
    const s = stateRef.current;
    if (!s.work || !s.chapterId || !s.doc) return;
    setSaveState('saving');
    try {
      const r = await api.saveChapter(s.work.id, s.chapterId, {
        title: s.title,
        contentJson: s.doc,
        text: s.text,
        snapshot: !!opts.snapshot,
        trigger: opts.snapshot ? 'manual' : 'auto',
      });
      dirtyRef.current = false;
      setSaveState('saved');
      // 回写本书内该章的字数，避免切换章节后总字数停留在旧值
      const wc = Number.isFinite(r?.wordCount) ? r.wordCount : countWords(s.text);
      setWork((prev) =>
        !prev
          ? prev
          : {
              ...prev,
              volumes: (prev.volumes || []).map((v) => ({
                ...v,
                chapters: (v.chapters || []).map((c) =>
                  c.id === s.chapterId ? { ...c, title: s.title, wordCount: wc } : c
                ),
              })),
            }
      );
      setWorks(await api.listWorks());
    } catch (e) {
      setSaveState('error');
      console.error(e);
    }
  }, []);

  const scheduleSave = React.useCallback(() => {
    dirtyRef.current = true;
    setSaveState('dirty');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSave(), SAVE_DELAY);
  }, [doSave]);

  /* 每 10 分钟留一次快照 */
  React.useEffect(() => {
    snapshotTimerRef.current = setInterval(() => {
      if (stateRef.current.work && dirtyRef.current) doSave({ snapshot: true });
    }, SNAPSHOT_INTERVAL);
    return () => clearInterval(snapshotTimerRef.current);
  }, [doSave]);

  /* 快捷键：Esc 专注，Ctrl/Cmd+S 保存并留快照 */
  React.useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setFocus((f) => !f);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave({ snapshot: true }).then(loadSnapshots);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        if (stateRef.current.work && stateRef.current.chapterId) setModal('ai');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doSave]);

  /* 离开页面前兜底保存 */
  React.useEffect(() => {
    function onLeave(e) {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
      const s = stateRef.current;
      if (s.work && s.chapterId) {
        fetch(`/api/works/${s.work.id}/chapters/${s.chapterId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: s.title, contentJson: s.doc, text: s.text, snapshot: true }),
          keepalive: true,
        });
      }
    }
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, []);

  /* ---------------- 导航 ---------------- */
  async function openWork(id) {
    await doSave();
    const w = await api.getWork(id);
    setWork(w);
    setSettings((await api.getSettings(id)).settings);
    setPanel(null);
    setView('work');
    setChapterId(null); // 进作品默认看概览，不自动打开章节
  }

  async function openTopic(id, from = 'home') {
    if (from === 'work') await doSave();
    setTopicId(id);
    setTopicBack(from);
    setView('topic');
  }

  async function closeTopic() {
    await refreshTopics();
    if (topicBack !== 'home' && works.some((w) => w.id === topicBack)) {
      await openWork(topicBack);
    } else {
      setView('home');
      setWorks(await api.listWorks());
    }
  }

  const loadSnapshots = React.useCallback(async () => {
    const s = stateRef.current;
    if (!s.work || !s.chapterId) return;
    const r = await api.snapshots(s.work.id, s.chapterId);
    setSnapshots(r.snapshots);
  }, []);

  async function openChapter(wid, cid, w) {
    const cur = stateRef.current;
    if (cur.work && cur.chapterId && cur.chapterId !== cid) await doSave();
    const current = w || work || (await api.getWork(wid));
    if (!work) setWork(current);
    const d = await api.getChapter(wid, cid);
    setChapterId(cid);
    setDoc(d.contentJson);
    setText(d.text || '');
    setTitle(d.title || '');
    setSaveState('saved');
    dirtyRef.current = false;
    const r = await api.snapshots(wid, cid);
    setSnapshots(r.snapshots);
  }

  async function backOverview() {
    await doSave();
    setChapterId(null);
    setDoc(null);
    setPanel(null);
  }

  async function backHome() {
    await doSave();
    setWork(null);
    setChapterId(null);
    setDoc(null);
    setPanel(null);
    setView('home');
    setWorks(await api.listWorks());
    await refreshTopics();
  }

  /* ---------------- 选题 ---------------- */
  async function createTopic(data) {
    const t = await api.createTopic(data);
    await refreshTopics();
    return t;
  }

  async function patchTopic(id, patch) {
    await api.updateTopic(id, patch);
    await refreshTopics();
  }

  async function dropTopic(id) {
    await api.updateTopic(id, { status: 'dropped' });
    await refreshTopics();
    if (view === 'topic' && topicId === id) setView('home');
  }

  async function purgeTopic(id) {
    if (!confirm('永久删除这个选题？不可恢复。')) return;
    await api.deleteTopic(id);
    await refreshTopics();
  }

  async function startWork({ title: bookTitle, topicId: tid }) {
    const w = await api.createWork({ title: bookTitle, topicId: tid });
    setWorks(await api.listWorks());
    await refreshTopics();
    if (w) await openWork(w.id);
  }

  /** 一键成书完成后：关掉向导并打开作品概览（刷新字数/章节） */
  async function finishCompose(wid) {
    setCompose(null);
    if (wid) {
      await api.listWorks().catch(() => {});
      await openWork(wid);
    }
  }

  /* ---------------- 章节操作 ---------------- */
  async function addChapter(volumeId) {
    if (!work) return;
    let vid = volumeId;
    if (!vid) {
      const w0 = await api.getWork(work.id);
      if (!w0.volumes || !w0.volumes.length) {
        const v = await api.addVolume(work.id, '第一卷');
        vid = v.id;
      } else {
        vid = w0.volumes[0].id;
      }
    }
    const c = await api.addChapter(work.id, vid);
    const w = await api.getWork(work.id);
    setWork(w);
    await openChapter(work.id, c.id, w);
  }

  /** 一键续写下一章：承接最后一章生成整章 → 落成新章节 → 自动打开 */
  async function nextChapter() {
    if (!work) return;
    setNextBusy(true);
    setNextMsg('');
    try {
      const res = await api.aiNextChapter(work.id, {});
      const w = await api.getWork(work.id);
      setWork(w);
      setWorks(await api.listWorks());
      if (res?.chapter?.id) await openChapter(work.id, res.chapter.id, w);
      setNextMsg(`已续写《${res?.chapter?.title || '新章节'}》`);
      setTimeout(() => setNextMsg(''), 4000);
    } catch (e) {
      alert(e.message || '续写失败');
    } finally {
      setNextBusy(false);
    }
  }

  async function addVolume() {
    if (!work) return;
    await api.addVolume(work.id);
    setWork(await api.getWork(work.id));
  }

  async function deleteChapter(cid) {
    if (!work) return;
    await api.deleteChapter(work.id, cid);
    const w = await api.getWork(work.id);
    setWork(w);
    const first = w.volumes?.[0]?.chapters?.[0];
    if (first) await openChapter(work.id, first.id, w);
    else setChapterId(null);
  }

  async function makeSnapshot() {
    await doSave({ snapshot: true });
    await loadSnapshots();
  }

  async function restoreSnapshot(ts) {
    if (!work || !chapterId) return;
    if (!confirm('用该快照覆盖当前内容？当前内容会先被保存为快照。')) return;
    await doSave({ snapshot: true });
    const s = await api.readSnapshot(work.id, chapterId, ts);
    setDoc(s.contentJson);
    setText(s.text || '');
    setTitle(s.title || '');
    await doSave();
    await loadSnapshots();
  }

  async function toggleTopicPanel() {
    if (panel === 'topic') return setPanel(null);
    setPanel('topic');
  }

  /* 一键复制本章：标题 + 正文 */
  async function copyChapter() {
    const cur = stateRef.current;
    if (!cur.text) return;
    const content = `${cur.title?.trim() ? cur.title.trim() + '\n\n' : ''}${cur.text}`;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* 忽略，走下方提示 */
      }
      document.body.removeChild(ta);
    }
    setCopyTip('已复制本章内容');
    setTimeout(() => setCopyTip(''), 1600);
  }

  const saveSettingsNow = React.useCallback(async (s) => {
    const cur = stateRef.current;
    if (!cur.work) return;
    await api.saveSettings(cur.work.id, s);
    setSettings(s);
  }, []);

  /** 给早期建的作品补关联选题，并继承题材/目标（已有的不覆盖） */
  async function attachTopic(tid) {
    if (!work || !tid) return;
    const t = topics.find((x) => x.id === tid);
    if (!t) return;
    await api.updateWork(work.id, {
      topicId: tid,
      genre: work.genre || t.genre || '',
      targetPlatform: work.targetPlatform || t.platform || 'fanqie',
      logline: work.logline || t.logline || '',
      tags: work.tags?.length ? work.tags : t.tags || [],
      refWorks: work.refWorks?.length ? work.refWorks : t.refWorks || [],
      targetWords: work.targetWords || t.plan?.targetWords || 0,
      dailyGoal: work.dailyGoal || t.plan?.dailyWords || 0,
    });
    setWork(await api.getWork(work.id));
    await refreshTopics();
  }

  /* ---------------- 渲染 ---------------- */
  const allWords = (Array.isArray(works) ? works : []).reduce((n, w) => n + (w.wordCount || 0), 0);
  const today = readToday(allWords);
  const chapterWords = countWords(text);
  // 全书字数 = 各章已存字数之和；当前打开的这一章用实时字数（含未保存改动）
  const bookWords =
    (work?.volumes || []).reduce(
      (n, v) =>
        n +
        (v.chapters || []).reduce(
          (m, c) => m + (c.id === chapterId ? 0 : c.wordCount || 0),
          0
        ),
      0
    ) + (chapterId ? chapterWords : 0);
  const goal = (work && work.dailyGoal) || meta.dailyGoal || 4000;
  const pct = Math.min(100, Math.round((today.gained / goal) * 100));
  const topicArr = Array.isArray(topics) ? topics : [];
  const currentTopic = topicArr.find((t) => t.id === topicId) || null;
  const workTopic = work ? topicArr.find((t) => t.id === work.topicId) || null : null;

  // 弹窗统一渲染：挂到所有返回路径上，避免 early return 把 modal 吞掉（首页点 AI 设置无反应就是这原因）
  const modals = (
    <>
      {modal === 'selfcheck' && work && <SelfCheckPanel work={work} onClose={() => setModal(null)} />}
      {modal === 'review' && work && (
        <ReviewPanel work={work} chapterId={chapterId} onClose={() => setModal(null)} />
      )}
      {modal === 'ai-config' && (
        <AiSettings initial={aiCfg} onClose={() => setModal(null)} onSaved={(r) => setAiCfg(r)} onImgSaved={(r) => setImgCfg(r)} />
      )}
      {modal === 'first-chapters' && work && (
        <FirstChapters
          work={work}
          topic={topics.find((t) => t.id === work.topicId) || null}
          onClose={() => setModal(null)}
          onWritten={async (ids) => {
            const w = await api.getWork(work.id);
            setWork(w);
            setWorks(await api.listWorks());
            if (ids?.[0]) await openChapter(work.id, ids[0], w);
            setModal(null);
          }}
        />
      )}
      {modal === 'topic-ai' && (
        <TopicAi
          mode={topicAiMode}
          topic={topicAiMode === 'fill' ? currentTopic : null}
          aiConfigStatus={aiCfg}
          onOpenSettings={() => setModal('ai-config')}
          onClose={() => setModal(null)}
          onAdopt={async (fields) => {
            const t = await createTopic(fields);
            setModal(null);
            openTopic(t.id, 'home');
          }}
          onApply={async (fields) => {
            if (currentTopic) await patchTopic(currentTopic.id, fields);
            setModal(null);
          }}
        />
      )}
      {compose && (
        <ComposeWizard
          mode={compose.mode}
          work={compose.mode === 'work' ? work : null}
          aiCfg={aiCfg}
          onClose={() => setCompose(null)}
          onOpenSettings={() => setModal('ai-config')}
          onDone={finishCompose}
        />
      )}
    </>
  );

  if (loading) return <div className="loading">载入中…</div>;

  if (view === 'topic') {
    return (
      <>
        <TopicDetail
          topic={currentTopic}
          onBack={closeTopic}
          onPatch={patchTopic}
          onStartWork={startWork}
          onDelete={dropTopic}
          onAiFill={() => {
            setTopicAiMode('fill');
            setModal('topic-ai');
          }}
        />
        {modals}
      </>
    );
  }

  if (!work) {
    return (
      <>
        <Home
          topics={topics}
          works={works}
          aiCfg={aiCfg}
          onOpenAiSettings={() => setModal('ai-config')}
          onCreateTopic={createTopic}
          onOpenTopic={(id) => openTopic(id, 'home')}
          onOpenWork={openWork}
          onOpenTopicAiGen={() => {
            setTopicAiMode('create');
            setModal('topic-ai');
          }}
          onComposeScratch={() => setCompose({ mode: 'scratch', workId: null })}
          onDeleteWork={async (id) => {
            if (!confirm('删除这部作品及其所有章节？')) return;
            await api.deleteWork(id);
            setWorks(await api.listWorks());
          }}
          onDeleteTopic={dropTopic}
          onPurgeTopic={purgeTopic}
        />
        {modals}
      </>
    );
  }

  const saveLabel = { saved: '已保存', saving: '保存中…', dirty: '未保存', error: '保存失败' }[saveState];

  const aiInfo = aiRatioOf(doc);
  const aiTh = platformThreshold(work?.targetPlatform || 'fanqie');
  const aiClass =
    aiInfo.ratio <= aiTh.green ? 'ok' : aiInfo.ratio <= aiTh.yellow ? 'warn' : 'danger';

  return (
    <div className={`app ${focus ? 'focus' : ''}`}>
      <header className="topbar">
        <button className="link-btn" onClick={backHome}>
          ‹ 作品
        </button>
        {chapterId && (
          <button className="link-btn" onClick={backOverview} title="返回作品概览">
            ‹ 概览
          </button>
        )}
        <span
          className={`work-title ${chapterId ? 'clickable' : ''}`}
          title={chapterId ? '点击返回作品概览' : work.logline || work.title}
          onClick={chapterId ? backOverview : undefined}
        >
          {work.title}
        </span>
        {!!work.logline && <span className="work-logline">{work.logline}</span>}
        <div className="spacer" />
        <span className="words" title="本书全部章节字数合计（含当前未保存改动）">
          {bookWords.toLocaleString()} 字
        </span>
        <span className="goal" title="今日目标">
          今日 {today.gained.toLocaleString()}/{goal.toLocaleString()}
          <i className="bar">
            <b style={{ width: `${pct}%` }} />
          </i>
        </span>
        <span className={`save s-${saveState}`}>{saveLabel}</span>
        <button
          className={`btn ${panel === 'topic' ? 'on' : ''}`}
          onClick={toggleTopicPanel}
          title={work.topicId ? '看当初定的选题' : '给这部作品补一个选题'}
        >
          选题
        </button>
        <button
          className={`btn ${panel === 'settings' ? 'on' : ''}`}
          onClick={() => setPanel(panel === 'settings' ? null : 'settings')}
          title="人物 / 世界观 / 大纲"
        >
          设定
        </button>
        <TopMenu
          label={
            <>
              AI
              <i className={`ai-pip ${aiCfg.configured || aiCfg.ready ? 'on' : 'off'}`} title={aiCfg.configured || aiCfg.ready ? 'AI 已配置' : 'AI 未配置'} />
            </>
          }
          items={[
            {
              hint:
                aiCfg.configured || aiCfg.ready
                  ? `生效模型：${aiCfg.model || '已配置'}`
                  : 'AI 未配置，请先在 AI 设置里配置',
            },
            { label: '续写本段', tip: 'Ctrl+J', onClick: () => setModal('ai') },
            { label: nextBusy ? '续写下一章…' : '续写下一章', tip: '整章', disabled: nextBusy, onClick: nextChapter },
            { sep: true },
            { label: '开局 · 写前几章', tip: '黄金三章', onClick: () => setModal('first-chapters') },
            { label: '审阅', tip: '编辑视角', onClick: () => setModal('review') },
            { label: '自检', tip: '投稿前报告', onClick: () => setModal('selfcheck') },
            { sep: true },
            { label: 'AI 设置…', onClick: () => setModal('ai-config') },
          ]}
        />
        <TopMenu
          label="更多"
          items={[
            { label: focus ? '退出专注模式' : '专注模式', onClick: () => setFocus((f) => !f) },
            { sep: true },
            {
              label: '备份',
              tip: 'backups/',
              onClick: () => api.backup().then(() => alert('已备份到 backups/')),
            },
            { label: '导出全书', onClick: () => window.open(api.exportUrl(work.id), '_blank') },
            {
              label: panel === 'snapshot' ? '快照 ✓' : '快照记录',
              onClick: () => setPanel(panel === 'snapshot' ? null : 'snapshot'),
            },
          ]}
        />
        {nextMsg && <span className="hint rv-toast">{nextMsg}</span>}
      </header>

      <div className="body">
        <nav className="sidebar">
          <ChapterTree
            work={work}
            currentId={chapterId}
            onSelect={(cid) => openChapter(work.id, cid)}
            onAddChapter={addChapter}
            onAddVolume={addVolume}
            onDeleteChapter={deleteChapter}
          />
        </nav>

        <main className="main">
          {chapterId ? (
            <>
              <input
                className="ch-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  scheduleSave();
                }}
                placeholder="章节标题"
              />
              <Editor
                key={chapterId}
                ref={editorRef}
                value={doc}
                placeholder="从这里开始写…"
                onChange={(json, txt) => {
                  setDoc(json);
                  setText(txt);
                  scheduleSave();
                }}
                onSave={() => doSave()}
              />
              <footer className="statusbar">
                <span>本章 {chapterWords.toLocaleString()} 字</span>
                <span className={`ai-pct ${aiClass}`} title="本章 AI 参与比例（来自改写工作台插入的文本）">
                  AI {Math.round(aiInfo.ratio * 100)}%
                </span>
                <span className="spacer" />
                <button
                  className="btn small ghost"
                  style={{ marginRight: 8 }}
                  onClick={copyChapter}
                  disabled={!text}
                  title="复制本章标题与正文到剪贴板"
                >
                  复制本章
                </button>
                <span className="hint">{copyTip || (saveState === 'saved' ? '内容已写入本地文件' : '')}</span>
              </footer>
            </>
          ) : (
            <WorkOverview
              work={work}
              wordCount={bookWords}
              settings={settings}
              topic={workTopic}
              aiCfg={aiCfg}
              imgCfg={imgCfg}
              onOpenChapter={(cid) => openChapter(work.id, cid)}
              onStartWrite={() => addChapter(work.volumes?.[0]?.id)}
              onOpenTopic={() => toggleTopicPanel()}
              onOpenAiSettings={() => setModal('ai-config')}
              onCompose={() => setCompose({ mode: 'work', workId: work.id })}
            />
          )}
        </main>

        {panel === 'snapshot' && (
          <SidePanel
            snapshots={snapshots}
            gitAvailable={gitOk}
            onSnapshot={makeSnapshot}
            onRestore={restoreSnapshot}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'topic' && (
          <TopicBrief
            topic={workTopic}
            topics={topics}
            onAttach={attachTopic}
            onOpen={() => workTopic && openTopic(workTopic.id, 'work')}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'settings' && (
          <SettingsPanel
            key={work.id}
            work={work}
            initial={settings}
            onSave={saveSettingsNow}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {modal === 'ai' && (
        <AiContinuePanel
          workId={work.id}
          platform={work.targetPlatform}
          preceding={text}
          aiConfigStatus={aiCfg}
          onOpenSettings={() => setModal('ai-config')}
          onClose={() => setModal(null)}
          onInsert={(t, ratio) => {
            const th = platformThreshold(work.targetPlatform).rewrite;
            editorRef.current?.insertAiText(t, ratio, ratio >= th);
            setModal(null);
          }}
        />
      )}
      {modals}
    </div>
  );
}
