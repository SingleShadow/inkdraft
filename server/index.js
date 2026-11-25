import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  initStore, getMeta, setMeta,
  listTopics, getTopic, createTopic, updateTopic, deleteTopic, scoreTopic,
  listWorks, getWork, createWork, updateWork, deleteWork,
  getSettings, saveSettings, buildSettingContext,
  addVolume, addChapter, renameChapter, deleteChapter,
  readChapter, writeChapter, emptyDoc, textToDoc,
  listSnapshots, readSnapshot, saveSnapshot,
  exportWorkTxt, getStats, countWords, dataSize, DATA_DIR, getAiConfig, saveAiConfig, checkTitle,   getImageConfig, saveImageConfig, loadImageConfig, getImageProviders, loadAiProviders,
  getComposePlan, saveComposePlan,
} from './store.js';
import { aiConfig, continueNovel, loadSensitive, generateTopic, generateNames, generateOutline, generateChars, generateFirstChapters, generateNextChapter, reviewText, generateImage, buildCoverPrompt, generateVolumes, generateChapterPlan, generateChapterFromPlan, testImageConnection, testChatConnection } from './ai.js';
import { scanSensitive, detectFormatIssues, collectAiSpans } from './check.js';
import { ensureRepo, scheduleCommit, commitNow, listCommits, showFileAt, isAvailable } from './git.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DIST = path.resolve(__dirname, '..', 'dist');
const BACKUP_DIR = path.resolve(process.cwd(), 'backups');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 20 * 1024 * 1024) throw new Error('payload too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/* ---------------- API ---------------- */

/* ---------- 章节标题编号归一：统一阿拉伯数字，序号从上一章标题推导 ---------- */
const CN_D = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_U = { 十: 10, 百: 100, 千: 1000 };
/** 中文/阿拉伯数字统一转整数（支持 一 ~ 九千九百九十九） */
function cnToInt(s) {
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  let total = 0;
  let cur = 0;
  for (const ch of String(s)) {
    if (ch in CN_D) cur = CN_D[ch];
    else if (ch in CN_U) {
      total += (cur || 1) * CN_U[ch];
      cur = 0;
    }
  }
  return total + cur;
}
/** 从上一章标题解析章节序号，解析不出返回 null */
function prevChapterNo(prevTitle) {
  const m = String(prevTitle || '').match(/^第([0-9一二三四五六七八九十百千零〇两]+)[章回节]/);
  if (!m) return null;
  const n = cnToInt(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/** 生成新章标题：第N章 + 正题名（N 恒为阿拉伯数字） */
function normalizeChapterTitle(rawTitle, index, prevTitle) {
  // 模型偶尔仍会带编号，先剥掉任何「第X章/节/回」前缀
  const bare = String(rawTitle || '')
    .trim()
    .replace(/^第[0-9一二三四五六七八九十百千零〇两]+[章回节]\s*[::]?\s*/, '')
    .trim();
  const m = String(prevTitle || '').match(/^[^章回节]*?[章回节](\s*)/);
  const sep = m && m[1] ? m[1] : bare ? ' ' : '';
  return `第${index}章` + (bare ? sep + bare : '');
}

/** 把大纲对象转成设定库的「详纲·」节点（与 createWork 迁移一致，供「设定」面板复用） */
function outlineToNodes(o = {}) {
  const parts = [
    ['故事背景', o.background],
    ['主旨 / 灵魂', o.theme],
    ['主线', o.mainline],
    ['支线与副本', o.branches],
    ['隐藏线（暗线）', o.hidden],
    ['分卷推进', o.stages],
    ['时间轴', o.timeline],
    ['结局设定', o.ending?.trim() ? `${o.endingType ? `（${o.endingType}）` : ''}${o.ending.trim()}` : ''],
    ['备选预案', o.backup],
    ['故事卖点', o.selling],
  ];
  const out = [];
  parts.forEach(([title, text], idx) => {
    const t = String(text || '').trim();
    if (!t) return;
    out.push({
      id: crypto.randomUUID().slice(0, 8),
      type: 'volume',
      title: `详纲·${title}`,
      parentId: null,
      content: t,
      targetWords: 0,
      linkedChapterId: null,
      order: idx,
    });
  });
  return out;
}

const routes = {
  'GET /api/meta': async () => ({ meta: await getMeta(), stats: await getStats(), size: await dataSize() }),

  'PUT /api/meta': async (req) => {
    const p = await body(req);
    return { meta: await setMeta(p) };
  },

  /* 选题：作品的上游，先想清楚写什么 */
  'GET /api/topics': async () => {
    const list = await listTopics();
    return { topics: list.map((t) => ({ ...t, eval: scoreTopic(t) })) };
  },

  'POST /api/topics': async (req) => {
    const p = await body(req);
    const t = await createTopic(p);
    scheduleCommit(`feat: 新选题「${t.title}」`);
    return t;
  },

  'GET /api/topics/:id': async (req, params) => {
    const t = await getTopic(params.id);
    if (!t) return { error: 'not found' };
    return { ...t, eval: scoreTopic(t) };
  },

  'PUT /api/topics/:id': async (req, params) => {
    const p = await body(req);
    const t = await updateTopic(params.id, p);
    scheduleCommit('chore: 更新选题');
    return { ...t, eval: scoreTopic(t) };
  },

  'DELETE /api/topics/:id': async (req, params) => {
    await deleteTopic(params.id);
    scheduleCommit('chore: 删除选题');
    return { ok: true };
  },

  'GET /api/works': async () => ({ works: await listWorks() }),

  'POST /api/works': async (req) => {
    const p = await body(req);
    const w = await createWork(p);
    const topic = p.topicId ? await getTopic(p.topicId) : null;
    scheduleCommit(`feat: 开书《${w.title}》${topic ? `（选题「${topic.title}」）` : ''}`);
    return w;
  },

  'GET /api/works/:id': async (req, params) => {
    const w = await getWork(params.id);
    if (!w) return { error: 'not found' };
    return w;
  },

  'PUT /api/works/:id': async (req, params) => {
    const p = await body(req);
    const w = await updateWork(params.id, p);
    scheduleCommit('chore: 更新作品信息');
    return w;
  },

  'DELETE /api/works/:id': async (req, params) => {
    await deleteWork(params.id);
    scheduleCommit('chore: 删除作品');
    return { ok: true };
  },

  'POST /api/works/:id/volumes': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const v = await addVolume(params.id, p.title);
    scheduleCommit('chore: 新增卷');
    return v;
  },

  'POST /api/works/:id/volumes/:vid/chapters': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const c = await addChapter(params.id, params.vid, p.title);
    scheduleCommit('chore: 新增章节');
    return c;
  },

  'GET /api/works/:id/chapters/:cid': async (req, params) => {
    const d = await readChapter(params.id, params.cid);
    return d || { id: params.cid, title: '', contentJson: emptyDoc(), text: '', wordCount: 0 };
  },

  'PUT /api/works/:id/chapters/:cid': async (req, params) => {
    const p = await body(req);
    const text = typeof p.text === 'string' ? p.text : '';
    const data = {
      id: params.cid,
      title: p.title || '',
      contentJson: p.contentJson || emptyDoc(),
      text,
      wordCount: countWords(text),
      updatedAt: Date.now(),
    };
    // snapshot=true 时额外落一个快照（手动保存 / 定时保存）
    await writeChapter(params.id, params.cid, data, {
      snapshot: !!p.snapshot,
      snapshotTrigger: p.trigger || 'manual',
    });
    scheduleCommit(`docs: ${data.title || '章节'} (${data.wordCount}字)`);
    return { ok: true, wordCount: data.wordCount, updatedAt: data.updatedAt };
  },

  'PUT /api/works/:id/chapters/:cid/title': async (req, params) => {
    const p = await body(req);
    await renameChapter(params.id, params.cid, p.title);
    scheduleCommit('chore: 重命名章节');
    return { ok: true };
  },

  'DELETE /api/works/:id/chapters/:cid': async (req, params) => {
    await deleteChapter(params.id, params.cid);
    scheduleCommit('chore: 删除章节');
    return { ok: true };
  },

  'GET /api/works/:id/chapters/:cid/snapshots': async (req, params) => ({
    snapshots: await listSnapshots(params.id, params.cid),
  }),

  'GET /api/works/:id/chapters/:cid/snapshots/:ts': async (req, params) => {
    const s = await readSnapshot(params.id, params.cid, params.ts);
    return s || { error: 'not found' };
  },

  'POST /api/works/:id/chapters/:cid/snapshots': async (req, params) => {
    const d = await readChapter(params.id, params.cid);
    if (!d) return { error: 'not found' };
    const ts = await saveSnapshot(params.id, params.cid, d, 'manual');
    scheduleCommit('chore: 手动快照');
    return { ok: true, ts };
  },

  /* 设定库：人物 / 世界观 / 大纲（W2） */
  'GET /api/works/:id/settings': async (req, params) => ({
    settings: await getSettings(params.id),
  }),

  'PUT /api/works/:id/settings': async (req, params) => {
    const p = await body(req);
    const s = await saveSettings(params.id, p);
    scheduleCommit('chore: 更新设定库');
    return s;
  },

  'GET /api/works/:id/settings/context': async (req, params) => ({
    context: await buildSettingContext(params.id),
  }),

  /* AI 续写（W3）：兼容 OpenAI 协议的适配器 */
  'GET /api/ai/config': async () => getAiConfig(),

  'PUT /api/ai/config': async (req) => {
    const p = await body(req);
    return saveAiConfig(p || {});
  },

  'POST /api/works/:id/ai/continue': async (req, params) => {
    const p = await body(req);
    const settingContext = await buildSettingContext(params.id);
    const w = await getWork(params.id);
    const r = await continueNovel({
      settingContext,
      preceding: p.preceding || '',
      intent: p.intent || '',
      tone: p.tone || 'natural',
      length: Number(p.length) || 500,
      platform: w?.targetPlatform || 'fanqie',
      candidates: 2,
    });
    return r;
  },

  /* 一键续写下一章：承接最后一章 → 生成整章 → 落成新章节 */
  'POST /api/works/:id/ai/next-chapter': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const w = await getWork(params.id);
    if (!w) throw new Error('作品不存在');
    let lastVol = null;
    let lastCh = null;
    for (const v of w.volumes || []) {
      for (const c of v.chapters || []) {
        lastVol = v;
        lastCh = c;
      }
    }
    if (!lastCh || !lastVol) throw new Error('还没有任何章节，先用「开局」写前几章');
    const d = await readChapter(params.id, lastCh.id);
    const settingContext = await buildSettingContext(params.id);
    const draft = await generateNextChapter({
      settingContext,
      prevTail: String(d?.text || ''),
      intent: p.intent || '',
      words: Number(p.words) || 1200,
      platform: w.targetPlatform || 'fanqie',
    });
    const text = String(draft.text || '').trim();
    if (!text) throw new Error('生成内容为空，再试一次');
    // 序号优先从上一章标题推导（不受空章节干扰），推导不出再按章节数
    const chCount = (w.volumes || []).reduce((n, v) => n + (v.chapters || []).length, 0);
    const nextIndex = (prevChapterNo(lastCh.title) ?? chCount) + 1;
    const newTitle = normalizeChapterTitle(draft.title, nextIndex, lastCh.title);
    const c = await addChapter(params.id, lastVol.id, newTitle);
    const data = {
      id: c.id,
      title: newTitle,
      contentJson: textToDoc(text),
      text,
      wordCount: countWords(text),
      updatedAt: Date.now(),
    };
    await writeChapter(params.id, c.id, data);
    scheduleCommit(`chore: AI 续写《${data.title}》`);
    return { chapter: c, draft: { ...draft, wordCount: data.wordCount }, from: { id: lastCh.id, title: lastCh.title } };
  },

  /* 稿件审阅：编辑视角的内容评审（自检查的是敏感词/AI占比等机械项，这里评内容） */
  'POST /api/works/:id/ai/review': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const w = await getWork(params.id);
    if (!w) throw new Error('作品不存在');
    const flat = [];
    for (const v of w.volumes || []) for (const c of v.chapters || []) flat.push(c);
    if (!flat.length) throw new Error('还没有章节可审阅');

    let target = null;
    let text = '';
    let title = '';
    if (p.chapterId) {
      target = flat.find((c) => c.id === p.chapterId) || null;
      if (!target) throw new Error('章节不存在');
      const d = await readChapter(params.id, target.id);
      text = String(d?.text || '');
      title = target.title || '';
    } else if (p.scope === 'all') {
      const parts = [];
      for (const c of flat) {
        const d = await readChapter(params.id, c.id);
        parts.push(`【${c.title}】\n${String(d?.text || '')}`);
      }
      text = parts.join('\n\n');
      title = `全书 ${flat.length} 章`;
    } else {
      target = flat[flat.length - 1];
      const d = await readChapter(params.id, target.id);
      text = String(d?.text || '');
      title = target.title || '';
    }
    if (!text.trim()) throw new Error('这一章还是空的，先写点东西再审阅');

    const idx = target ? flat.findIndex((c) => c.id === target.id) : -1;
    const settingContext = await buildSettingContext(params.id);
    const r = await reviewText({
      text,
      chapterTitle: title,
      isOpening: idx >= 0 && idx < 3,
      settingContext,
    });
    return { ...r, chapterTitle: title, scope: p.chapterId ? 'chapter' : p.scope === 'all' ? 'all' : 'chapter' };
  },

  /* 图片模型配置（多模态，用于生成封面） */
  'GET /api/ai/image-config': async () => getImageConfig(),
  'POST /api/ai/image-config': async (req) => {
    const p = await body(req);
    return saveImageConfig(p);
  },

  /* 图片模型连通性测试：可传 {id} 测已存配置，或传 {baseURL,model,apiKey} 测表单值，都不传则测生效中 */
  'POST /api/ai/image/test': async (req) => {
    const p = await body(req).catch(() => ({}));
    let base, model, key;
    if (p.baseURL || p.model) {
      base = p.baseURL;
      model = p.model;
      key = p.apiKey || '';
    } else if (p.id) {
      const prov = (getImageProviders() || []).find((x) => x.id === p.id);
      if (!prov) throw new Error('找不到该图片模型配置');
      base = prov.baseURL;
      model = prov.model;
      key = prov.apiKey;
    } else {
      const eff = loadImageConfig();
      base = eff.base;
      model = eff.model;
      key = eff.key;
    }
    return testImageConnection({ base, key, model, timeout: Number(p.timeout) || 60000 });
  },

  /* 对话模型连通性测试：可传 {id} 测已存配置，或传 {baseURL,model,apiKey} 测表单值，都不传则测生效中 */
  'POST /api/ai/chat/test': async (req) => {
    const p = await body(req).catch(() => ({}));
    let base, model, key;
    if (p.baseURL || p.model) {
      base = p.baseURL;
      model = p.model;
      key = p.apiKey || '';
    } else if (p.id) {
      const prov = (loadAiProviders().providers || []).find((x) => x.id === p.id);
      if (!prov) throw new Error('找不到该模型配置');
      base = prov.baseURL;
      model = prov.model;
      key = prov.apiKey;
    } else {
      const eff = loadAiConfig();
      base = eff.base;
      model = eff.model;
      key = eff.key;
    }
    return testChatConnection({ base, key, model, timeout: Number(p.timeout) || 60000 });
  },

  /* 一键测试全部模型（对话 + 图片）：并发跑一遍，逐条返回结果 */
  'POST /api/ai/test-all': async () => {
    const { providers } = loadAiProviders();
    const imgs = getImageProviders() || [];
    const results = await Promise.all([
      ...providers.map(async (p) => {
        try {
          const r = await testChatConnection({ base: p.baseURL, key: p.apiKey, model: p.model });
          return { id: p.id, name: p.name, type: 'chat', model: p.model, ...r };
        } catch (e) {
          return { id: p.id, name: p.name, type: 'chat', model: p.model, ok: false, error: e?.message || String(e) };
        }
      }),
      ...imgs.map(async (p) => {
        try {
          const r = await testImageConnection({ base: p.baseURL, key: p.apiKey, model: p.model });
          return { id: p.id, name: p.name, type: 'image', model: p.model, ...r };
        } catch (e) {
          return { id: p.id, name: p.name, type: 'image', model: p.model, ok: false, error: e?.message || String(e) };
        }
      }),
    ]);
    const ok = results.filter((r) => r.ok).length;
    return { ok, failed: results.length - ok, total: results.length, results };
  },

  /* AI 生成封面图（需要多模态文生图模型） */
  'POST /api/ai/cover': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const workId = String(p.workId || params.workId || '').trim();
    if (!workId) throw new Error('缺少作品 ID');
    const img = getImageConfig();
    if (!img.enabled) throw new Error('图片模型未配置：请在「AI 设置 → 封面图片模型」填写多模态文生图模型的网关和模型名（普通对话模型不能生图）');
    const w = await getWork(workId);
    if (!w) throw new Error('作品不存在');
    const s = await getSettings(workId);
    const topic = w.topicId ? await getTopic(w.topicId).catch(() => null) : null;
    const prompt = String(p.prompt || '').trim() || buildCoverPrompt(w, s.settings || {}, topic);
    const b64 = await generateImage(prompt, { base: img.base, key: img.configured ? loadImageConfig().key : '', model: img.model });
    // b64 可能是 data: 前缀或 http url
    const dir = path.join(DATA_DIR, 'works', workId);
    await mkdir(dir, { recursive: true });
    if (b64.startsWith('http')) {
      await writeFile(path.join(dir, 'cover.txt'), b64, 'utf8');
    } else {
      const raw = b64.startsWith('data:') ? b64.split(',')[1] : b64;
      await writeFile(path.join(dir, 'cover.png'), Buffer.from(raw, 'base64'));
    }
    scheduleCommit(`feat: 生成《${w.title}》封面`);
    return { url: `/api/works/${workId}/cover?t=${Date.now()}`, prompt };
  },

  /* 读取封面图（无封面时 404，由前端显示占位） */
  'GET /api/works/:id/cover': async (req, params) => {
    const dir = path.join(DATA_DIR, 'works', params.id);
    const png = path.join(dir, 'cover.png');
    if (existsSync(png)) {
      return { __file: png, contentType: 'image/png' };
    }
    const txt = path.join(dir, 'cover.txt');
    if (existsSync(txt)) {
      const url = (await readFile(txt, 'utf8')).trim();
      return { __redirect: url };
    }
    throw Object.assign(new Error('no cover'), { status: 404 });
  },

  /* AI 选题生成：新选题 / 补全（W4） */
  'POST /api/ai/topic': async (req) => {
    const p = await body(req);
    return generateTopic({
      seed: p.seed || '',
      channel: p.channel || 'male',
      platform: p.platform || 'fanqie',
      mode: p.mode || 'new',
      current: p.current || null,
    });
  },

  /* 书名防重名校验：只查本地库，平台同名需作者自行搜索确认 */
  'POST /api/title/check': async (req) => {
    const p = await body(req);
    return checkTitle(p.title || '');
  },

  /* AI 人物小传起草（W4）：主角 + 主要配角 */
  'POST /api/ai/chars': async (req) => {
    const p = await body(req);
    return { chars: await generateChars(p.topic || {}, p.existing || []) };
  },

  /* AI 详纲起草：背景 / 主线 / 支线 / 暗线 / 分卷 / 结局 / 预案 / 卖点 */
  'POST /api/ai/outline': async (req) => {
    const p = await body(req);
    return generateOutline(p.topic || {});
  },

  /* AI 写前几章（黄金三章）：按题材套开头模板 + 四理论技法逐章生成 */
  'POST /api/ai/first-chapters': async (req) => {
    const p = await body(req);
    return generateFirstChapters(p.topic || {}, { count: p.count || 3, words: p.words || 1200 });
  },

  /* AI 书名候选：基于选题生成（W4） */
  'POST /api/ai/names': async (req) => {
    const p = await body(req);
    return { names: await generateNames(p.topic || {}) };
  },

  /* ============== 一键成书：五段式流水线（创意→大纲→分卷→章纲→正文） ============== */

  /* 把大纲对象转成设定库的「详纲」节点（与 createWork 迁移保持一致） */
  'POST /api/works/:id/compose/start': async (req, params) => {
    const existing = await getComposePlan(params.id);
    if (existing && existing.topic) return { plan: existing, recovered: true };
    const w = await getWork(params.id);
    if (!w) throw new Error('作品不存在');
    const topic = w.topicId ? await getTopic(w.topicId).catch(() => null) : null;
    const settings = await getSettings(params.id);
    let outline = null;
    if (topic?.detailOutline?.mainline) outline = topic.detailOutline;
    else {
      // 从设定库已有的「详纲·」节点重建一个粗略 outline 文本
      const nodes = (settings.outline || []).filter((n) => String(n.title || '').startsWith('详纲·'));
      if (nodes.length) {
        outline = {};
        for (const n of nodes) {
          const key = String(n.title || '').replace('详纲·', '');
          outline[key] = n.content || '';
        }
      }
    }
    const plan = {
      seed: '',
      topic: {
        title: topic?.title || w.title || '',
        logline: topic?.logline || w.logline || '',
        protagonist: topic?.protagonist || '',
        hook: topic?.hook || '',
        channel: topic?.channel || 'male',
        genre: w.genre || topic?.genre || '',
        platform: w.targetPlatform || topic?.platform || 'fanqie',
        tags: w.tags?.length ? w.tags : (topic?.tags || []),
        audience: topic?.audience || '',
        refWorks: topic?.refWorks || [],
      },
      bookName: w.title || '',
      outline: outline || null,
      chars: (settings.characters || []).map((c) => ({
        name: c.name, role: c.role, gender: c.gender, personality: c.personality,
        appearance: c.appearance, cause: c.background, goal: c.motivation,
        realGoal: '', flaw: c.weakness, habit: c.catchphrase, arc: c.arc, relation: c.note,
      })),
      volumes: [],
      stage: outline ? 'volumes' : 'outline',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveComposePlan(params.id, plan);
    return { plan, recovered: false };
  },

  'GET /api/works/:id/compose/plan': async (req, params) => ({
    plan: (await getComposePlan(params.id)) || null,
  }),

  /**
   * 跑某一个生成步骤并合并进计划、落盘。
   * step: outline（大纲+人物，同时写进设定库）/ volumes（分卷）/ chapters（某卷章纲）
   */
  'POST /api/works/:id/compose/step': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const plan = await getComposePlan(params.id);
    if (!plan) throw new Error('请先初始化成书计划（compose/start）');
    const w = await getWork(params.id);
    if (p.step === 'outline') {
      const outline = await generateOutline(plan.topic || {});
      const chars = await generateChars(plan.topic || {}, []);
      plan.outline = outline;
      plan.chars = chars;
      // 同步写入设定库，让「设定」面板也能看到（替换旧的详纲节点，保留用户其它节点）
      const s = await getSettings(params.id);
      const kept = (s.outline || []).filter((n) => !String(n.title || '').startsWith('详纲·'));
      const newNodes = outlineToNodes(outline);
      await saveSettings(params.id, { characters: chars, world: s.world, outline: [...kept, ...newNodes] });
      await saveComposePlan(params.id, plan);
      return { plan };
    }
    if (p.step === 'volumes') {
      const targetVolumes = Math.max(2, Math.min(40, Number(p.targetVolumes) || 3));
      const vols = await generateVolumes({ topic: plan.topic || {}, outline: plan.outline || {}, targetVolumes });
      plan.volumes = vols.map((v, i) => ({
        ...v,
        id: crypto.randomUUID().slice(0, 8),
        index: i,
        workVolumeId: null,
        chapters: [],
      }));
      await saveComposePlan(params.id, plan);
      return { plan };
    }
    if (p.step === 'chapters') {
      const vol = plan.volumes.find((v) => v.id === p.volumeId);
      if (!vol) throw new Error('卷不存在');
      const n = Math.max(3, Math.min(100, Number(p.chaptersPerVolume) || vol.chaptersPerVolume || 15));
      vol.chaptersPerVolume = n;
      const chapters = await generateChapterPlan({
        topic: plan.topic || {},
        outline: plan.outline || {},
        chars: plan.chars || [],
        volume: vol,
        volumeIndex: vol.index,
        totalVolumes: plan.volumes.length,
        chaptersPerVolume: n,
      });
      vol.chapters = chapters.map((c, i) => ({
        ...c,
        id: crypto.randomUUID().slice(0, 8),
        index: i,
        written: false,
        chapterId: null,
      }));
      await saveComposePlan(params.id, plan);
      return { plan };
    }
    throw new Error('未知的生成步骤');
  },

  /** 保存向导里的手动编辑（大纲/人物/分卷/章纲文本）回计划文件 */
  'POST /api/works/:id/compose/save': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const plan = await getComposePlan(params.id);
    if (!plan) throw new Error('成书计划不存在');
    const next = { ...plan, ...(p.patch || {}), updatedAt: Date.now() };
    await saveComposePlan(params.id, next);
    return { plan: next };
  },

  /**
   * 把计划里的卷同步成作品里的真实卷：
   * - 作品尚无任何「非空章节」时，清掉 createWork 默认建的那个空卷/空章，避免孤儿；
   * - 为每个计划卷确保一个作品卷（记录 workVolumeId），标题与计划卷保持一致。
   */
  'POST /api/works/:id/compose/sync-volumes': async (req, params) => {
    const plan = await getComposePlan(params.id);
    if (!plan) throw new Error('成书计划不存在');
    const w = await getWork(params.id);
    if (!w) throw new Error('作品不存在');
    const hasContent = (w.volumes || []).some((v) =>
      (v.chapters || []).some((c) => c.wordCount > 0 || !/^第[0-9一二三四五六七八九十百千]+章$/.test(c.title))
    );
    if (!hasContent) {
      w.volumes = [];
      await updateWork(params.id, w);
    }
    for (const pv of plan.volumes) {
      const exist = pv.workVolumeId && (w.volumes || []).find((v) => v.id === pv.workVolumeId);
      if (exist) {
        exist.title = pv.title || exist.title;
      } else {
        const v = await addVolume(params.id, pv.title || `第${pv.index + 1}卷`);
        pv.workVolumeId = v.id;
      }
    }
    await saveComposePlan(params.id, plan);
    return { plan };
  },

  /**
   * 写一章：按章纲（plot）生成正文 → 落成作品的新章节（全局 第N章 编号）→ 标记已写。
   * 上一章结尾由服务端自动读取，保证承接连贯。返回落盘结果供前端更新进度。
   */
  'POST /api/works/:id/compose/chapter': async (req, params) => {
    const p = await body(req).catch(() => ({}));
    const plan = await getComposePlan(params.id);
    if (!plan) throw new Error('成书计划不存在');
    const vol = plan.volumes.find((v) => v.id === p.volumeId);
    if (!vol) throw new Error('卷不存在');
    const pc = vol.chapters.find((c) => c.id === p.planChapterId);
    if (!pc) throw new Error('章纲不存在');
    const w = await getWork(params.id);
    if (!w) throw new Error('作品不存在');

    // 全书章节总数 → 全局序号；取最后一章用于承接与编号分隔符
    let lastVol = null;
    let lastCh = null;
    for (const v of w.volumes || []) for (const c of v.chapters || []) { lastVol = v; lastCh = c; }
    const chCount = (w.volumes || []).reduce((n, v) => n + (v.chapters || []).length, 0);

    const settingContext = await buildSettingContext(params.id);
    const lastData = lastCh ? await readChapter(params.id, lastCh.id) : null;
    const prevTail = String(lastData?.text || '').slice(-1400);

    // 前端「每章目标字数」优先；未传则用章纲自带 words（默认 1200），并夹在 400~4000 之间
    const reqWords = Number(p.words) || 0;
    const words = reqWords ? Math.max(400, Math.min(4000, reqWords)) : (pc.words || 1200);
    const draft = await generateChapterFromPlan({
      settingContext,
      plot: pc.plot || '',
      volumeSummary: vol.summary || '',
      tone: vol.tone || '',
      prevTail,
      words,
      platform: w.targetPlatform || 'fanqie',
      chapterTitle: pc.title || '',
    });
    const text = String(draft.text || '').trim();
    if (!text) throw new Error('生成内容为空，再试一次');

    const nextIndex = chCount + 1;
    const baseTitle = pc.title || draft.title || '';
    const newTitle = normalizeChapterTitle(baseTitle, nextIndex, lastCh?.title);
    const targetVol = w.volumes.find((v) => v.id === vol.workVolumeId) || lastVol;
    if (!targetVol) throw new Error('目标卷不存在，请先同步卷');
    const c = await addChapter(params.id, targetVol.id, newTitle);
    const data = {
      id: c.id,
      title: newTitle,
      contentJson: textToDoc(text),
      text,
      wordCount: countWords(text),
      updatedAt: Date.now(),
    };
    await writeChapter(params.id, c.id, data);

    pc.written = true;
    pc.chapterId = c.id;
    pc.title = pc.title || draft.title;
    pc.words = words; // 持久化本次目标字数，续写/重跑沿用
    await saveComposePlan(params.id, plan);
    scheduleCommit(`chore: 成书《${newTitle}》`);
    return { chapter: c, draft, title: newTitle, wordCount: data.wordCount, globalIndex: nextIndex };
  },

  /* 投稿前自检（W3）：敏感词 / 格式灌水 / AI 占比（本地，不拦截） */
  'GET /api/works/:id/selfcheck': async (req, params) => {
    const w = await getWork(params.id);
    if (!w) return { error: 'not found' };
    const dict = loadSensitive();
    const chapters = [];
    let totalWords = 0;
    let totalAiChars = 0;
    let totalChars = 0;
    const sensitive = [];
    const format = [];
    for (const v of w.volumes || []) {
      for (const c of v.chapters || []) {
        const d = await readChapter(params.id, c.id);
        const text = d?.text || '';
        const wc = countWords(text);
        totalWords += wc;
        const spans = collectAiSpans(d?.contentJson);
        const aiChars = spans.reduce((n, s) => n + (s.text || '').replace(/\s/g, '').length, 0);
        const chars = text.replace(/\s/g, '').length;
        totalAiChars += aiChars;
        totalChars += chars;
        const sens = scanSensitive(text, dict);
        const fmt = detectFormatIssues(text);
        if (sens.length) sensitive.push({ chapter: c.title, hits: sens });
        if (fmt.length) format.push({ chapter: c.title, issues: fmt });
        chapters.push({
          id: c.id,
          title: c.title,
          wordCount: wc,
          aiRatio: chars ? Number((aiChars / chars).toFixed(3)) : 0,
          sensitive: sens.length,
          format: fmt.length,
        });
      }
    }
    return {
      totalWords,
      totalAiRatio: totalChars ? Number((totalAiChars / totalChars).toFixed(3)) : 0,
      totalAiChars,
      totalChars,
      platform: w.targetPlatform,
      chapters,
      sensitive,
      format,
    };
  },

  'GET /api/works/:id/export.txt': async (req, params, res) => {
    const out = await exportWorkTxt(params.id);
    if (!out) return { error: 'not found' };
    const b = Buffer.from(out.content, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      'Content-Length': b.length,
    });
    res.end(b);
    return null; // 已直接响应
  },

  /* git 版本镜像 */
  'GET /api/git/status': async () => ({ available: await isAvailable() }),

  'GET /api/git/commits': async () => ({ commits: await listCommits(60) }),

  'GET /api/git/file': async (req, params, res, query) => {
    const content = await showFileAt(query.get('hash'), query.get('path'));
    return { content };
  },

  /* 备份：把 data 目录整体打包成一个 zip？——零依赖起见，做目录复制 */
  'POST /api/backup': async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, ts);
    await mkdir(dest, { recursive: true });
    await copyDir(DATA_DIR, path.join(dest, 'data'));
    scheduleCommit('chore: 备份前提交');
    await commitNow('chore: 备份前提交');
    return { ok: true, path: dest };
  },

  'GET /api/backups': async () => {
    const items = await readdir(BACKUP_DIR).catch(() => []);
    const out = [];
    for (const name of items.sort().reverse()) {
      const st = await stat(path.join(BACKUP_DIR, name)).catch(() => null);
      if (st?.isDirectory()) out.push({ name, mtime: st.mtimeMs });
    }
    return { backups: out };
  },
};

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true });
  const items = await readdir(src, { withFileTypes: true });
  for (const it of items) {
    const s = path.join(src, it.name);
    const d = path.join(dest, it.name);
    if (it.isDirectory()) await copyDir(s, d);
    else await writeFile(d, await readFile(s));
  }
}

function matchRoute(method, pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const key of Object.keys(routes)) {
    const [m, p] = key.split(' ');
    if (m !== method) continue;
    const kp = p.split('/').filter(Boolean);
    if (kp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < kp.length; i += 1) {
      if (kp[i].startsWith(':')) params[kp[i].slice(1)] = parts[i];
      else if (kp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

/* ---------------- static ---------------- */

async function serveStatic(req, res, pathname) {
  let file = path.join(DIST, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(DIST)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  if (!existsSync(file) || (await stat(file)).isDirectory()) {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'max-age=31536000',
  });
  createReadStream(file).pipe(res);
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname } = url;

  try {
    if (pathname.startsWith('/api/')) {
      const m = matchRoute(req.method, pathname);
      if (!m) return json(res, 404, { error: 'no route', path: pathname });
      const out = await m.handler(req, m.params, res, url.searchParams);
      if (out === null) return; // handler 已直接响应
      if (out && out.__file) {
        return createReadStream(out.__file).pipe(res.writeHead(200, { 'Content-Type': out.contentType || 'application/octet-stream' }));
      }
      if (out && out.__redirect) {
        return res.writeHead(302, { Location: out.__redirect }), res.end();
      }
      return json(res, 200, out);
    }
    if (!existsSync(DIST)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<meta charset="utf-8"><h2>墨稿 InkDraft</h2><p>前端未构建。开发模式请运行 <code>npm run dev</code>（Vite 5173）；生产模式请先 <code>npm run build</code>。</p>');
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error('[api]', err);
    json(res, err.status || 500, { error: String(err?.message || err) });
  }
});

await initStore();
await ensureRepo();

server.listen(PORT, () => {
  console.log(`\n  墨稿 InkDraft 已启动`);
  console.log(`  API  → http://localhost:${PORT}/api`);
  console.log(`  数据 → ${DATA_DIR}\n`);
});
