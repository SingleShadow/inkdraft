import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 数据层：零依赖 JSON 文件存储。
 * - 每部作品一个目录，每章一个 .json（正文 JSON）+ .md（Git 镜像纯文本）
 * - 快照写入 snapshots/<chapterId>/<ts>.json
 * - 之所以不用 SQLite：零安装风险、天然 Git 友好、备份就是拷目录。
 *   需要检索/复杂统计时再换 adapter，接口保持下面的形状即可。
 */

/**
 * 数据目录。测试时用 INKDRAFT_DATA 指到临时目录，避免冒烟测试误删真实稿件。
 */
export const DATA_DIR = path.resolve(process.env.INKDRAFT_DATA || path.join(process.cwd(), 'data'));
const WORKS_DIR = path.join(DATA_DIR, 'works');
const META_FILE = path.join(DATA_DIR, 'meta.json');
const TOPICS_FILE = path.join(DATA_DIR, 'topics.json');

const DEFAULT_META = {
  dailyGoal: 4000,
  targetPlatform: 'fanqie', // fanqie | qidian | jinjiang | free
  aiGuardEnabled: true,
};

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  // 先写临时文件再 rename，避免写一半断电导致文件损坏
  const tmp = `${file}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, file);
}

export async function initStore() {
  await ensureDir(WORKS_DIR);
  if (!existsSync(META_FILE)) await writeJson(META_FILE, DEFAULT_META);
}

/* ---------------- meta ---------------- */

export async function getMeta() {
  return { ...DEFAULT_META, ...(await readJson(META_FILE, {})) };
}

export async function setMeta(patch) {
  const meta = await getMeta();
  const next = { ...meta, ...patch };
  await writeJson(META_FILE, next);
  return next;
}

/* ---------------- topics（选题） ---------------- */

/**
 * 选题是「作品」的上游：先想清楚写什么，再决定书名开书。
 * 单独存 topics.json——数量少、读多写少，不必每本一个目录。
 */

export const TOPIC_STATUS = ['idea', 'candidate', 'adopted', 'dropped'];

async function saveTopics(list) {
  await writeJson(TOPICS_FILE, list);
}

export async function listTopics() {
  const all = await readJson(TOPICS_FILE, []);
  return Array.isArray(all) ? all : [];
}

export async function getTopic(id) {
  const list = await listTopics();
  return list.find((t) => t.id === id) || null;
}

export async function createTopic(data = {}) {
  const list = await listTopics();
  const now = Date.now();
  const t = {
    id: crypto.randomUUID().slice(0, 8),
    title: (data.title || '').trim() || '未命名选题',
    logline: data.logline || '',
    channel: data.channel || 'male',        // male | female
    genre: data.genre || '',                // 都市 / 玄幻 / 古言 …
    tags: Array.isArray(data.tags) ? data.tags : [],
    platform: data.platform || 'fanqie',
    audience: data.audience || '',
    refWorks: Array.isArray(data.refWorks) ? data.refWorks : [],
    hook: data.hook || '',
    protagonist: data.protagonist || '',
    plan: { targetWords: 1000000, dailyWords: 4000, publishAt: 60000, ...(data.plan || {}) },
    score: { familiarity: 3, stamina: 3, market: 3, ...(data.score || {}) },
    status: data.status || 'idea',
    workId: null,
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(t);
  await saveTopics(list);
  return t;
}

export async function updateTopic(id, patch = {}) {
  const list = await listTopics();
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const next = {
    ...list[i],
    ...patch,
    plan: { ...list[i].plan, ...(patch.plan || {}) },
    score: { ...list[i].score, ...(patch.score || {}) },
    updatedAt: Date.now(),
  };
  list[i] = next;
  await saveTopics(list);
  return next;
}

export async function deleteTopic(id) {
  const list = await listTopics();
  const next = list.filter((t) => t.id !== id);
  await saveTopics(next);
  return { ok: true };
}

/**
 * 选题自评：三项 1–5 分加权。
 * 权重刻意偏向 stamina（能写多长）——网文真正的失败原因不是开头不好，
 * 而是三十万字后写不下去。
 */
export function scoreTopic(t) {
  const s = t?.score || {};
  // 开书前自评五问：熟（读过同类）/ 懂（领域经验）/ 擅长（文笔匹配）/ 撑得住 / 平台吃
  const w = { familiarity: 0.2, domain: 0.15, strength: 0.15, stamina: 0.3, market: 0.2 };
  const total = Object.keys(w).reduce((n, k) => n + (Number(s[k]) || 0) * w[k], 0);
  const value = Math.round(total * 10) / 10;
  const verdict =
    value >= 4 ? { level: 'go', label: '可以开' } :
    value >= 3 ? { level: 'think', label: '再想想' } :
    { level: 'no', label: '先别开' };
  return { value, verdict };
}

/* ---------------- works ---------------- */

function workDir(id) {
  return path.join(WORKS_DIR, id);
}

export async function listWorks() {
  await ensureDir(WORKS_DIR);
  const ids = await readdir(WORKS_DIR).catch(() => []);
  const out = [];
  for (const id of ids) {
    const w = await readJson(path.join(workDir(id), 'work.json'));
    if (w) out.push(summarize(w));
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

function summarize(w) {
  let wordCount = 0;
  let chapterCount = 0;
  for (const v of w.volumes || []) {
    for (const c of v.chapters || []) {
      chapterCount += 1;
      wordCount += c.wordCount || 0;
    }
  }
  return {
    id: w.id,
    title: w.title,
    genre: w.genre,
    targetPlatform: w.targetPlatform,
    topicId: w.topicId || null,
    logline: w.logline || '',
    targetWords: w.targetWords || 0,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    wordCount,
    chapterCount,
  };
}

export async function getWork(id) {
  const w = await readJson(path.join(workDir(id), 'work.json'));
  return w;
}

/**
 * 建作品。v0.6 起建议传 topicId：书名之前先有选题，
 * 题材/平台/目标字数/日更目标全部从选题继承，避免开书时重新想一遍。
 */
/** 书名归一化：去空白与标点、转小写，用于重名/相似度比对 */
function normTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 最长公共子序列长度（书名短，直接 DP 足够） */
function lcsLen(a, b) {
  const m = b.length;
  let prev = new Array(m + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(m + 1).fill(0);
    for (let j = 1; j <= m; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[m];
}

/**
 * 书名防重名校验：与本地已有作品比对。
 * - duplicate：归一化后完全相同（禁止开书）
 * - similar：归一化后相似度 ≥75%（提示，不拦截）
 * 只查本地库；平台是否已有同名书需作者自行到平台搜索确认。
 */
export async function checkTitle(title) {
  const t = normTitle(title);
  if (!t) return { duplicate: null, similar: [] };
  const works = await listWorks();
  let duplicate = null;
  const similar = [];
  for (const w of works) {
    const wn = normTitle(w.title);
    if (!wn) continue;
    if (wn === t) {
      duplicate = { id: w.id, title: w.title };
      continue;
    }
    const score = (2 * lcsLen(t, wn)) / (t.length + wn.length);
    if (score >= 0.75) similar.push({ id: w.id, title: w.title, score: Math.round(score * 100) });
  }
  similar.sort((a, b) => b.score - a.score);
  return { duplicate, similar: similar.slice(0, 3) };
}

export async function createWork({ title, topicId, genre = '', targetPlatform = 'fanqie' }) {
  const id = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const volumeId = crypto.randomUUID().slice(0, 8);
  const chapterId = crypto.randomUUID().slice(0, 8);

  const topic = topicId ? await getTopic(topicId) : null;

  const work = {
    id,
    title: title || '未命名作品',
    genre: genre || topic?.genre || '',
    targetPlatform: targetPlatform || topic?.platform || 'fanqie',
    topicId: topic?.id || null,
    logline: topic?.logline || '',
    tags: topic?.tags || [],
    refWorks: topic?.refWorks || [],
    targetWords: topic?.plan?.targetWords || 0,
    dailyGoal: topic?.plan?.dailyWords || 0,
    createdAt: now,
    updatedAt: now,
    volumes: [
      {
        id: volumeId,
        title: '第一卷',
        order: 0,
        chapters: [
          {
            id: chapterId,
            title: '第一章',
            order: 0,
            wordCount: 0,
            updatedAt: now,
          },
        ],
      },
    ],
  };

  await writeJson(path.join(workDir(id), 'work.json'), work);
  await writeChapter(id, chapterId, {
    id: chapterId,
    title: '第一章',
    contentJson: emptyDoc(),
    text: '',
    wordCount: 0,
    updatedAt: now,
  });

  // 选题与作品建立关联，避免同一个选题重复开书；
  // 同时把开书前准备的「人物小传」与「详纲」迁移进设定库，AI 续写直接可用。
  if (topic) {
    const chars = (Array.isArray(topic.topicChars) ? topic.topicChars : [])
      .filter((c) => c && String(c.name || '').trim())
      .map((c, i) => {
        const bg = [
          c.archetype?.trim() && `现实原型：${c.archetype.trim()}`,
          c.cause?.trim() && `性格成因：${c.cause.trim()}`,
        ].filter(Boolean).join('；');
        const note = [
          c.camp?.trim() && `阵营：${c.camp.trim()}`,
          c.realGoal?.trim() && `真实欲望：${c.realGoal.trim()}`,
          c.relation?.trim() && `与主角：${c.relation.trim()}`,
        ].filter(Boolean).join('；');
        return {
          id: crypto.randomUUID().slice(0, 8),
          name: String(c.name).trim(),
          role: i === 0 ? '主角' : '重要配角',
          emoji: '👤',
          gender: c.gender || '',
          age: '',
          appearance: c.appearance || '',
          personality: c.personality || '',
          background: bg,
          motivation: c.goal || '',
          weakness: c.flaw || '',
          catchphrase: c.habit || '',
          arc: c.arc || '',
          relations: [],
          note,
        };
      });
    const o = topic.detailOutline || {};
    // 详纲各段独立成节点，AI 续写读取设定上下文时能逐条看到
    const outlineParts = [
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
    const outline = [];
    outlineParts.forEach(([title, text], idx) => {
      const t = String(text || '').trim();
      if (!t) return;
      outline.push({
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
    if (chars.length || outline.length) {
      await writeJson(path.join(workDir(id), 'settings.json'), { characters: chars, world: [], outline });
    }
    await updateTopic(topic.id, { status: 'adopted', workId: id });
  }
  return work;
}

export async function updateWork(id, patch) {
  const w = await getWork(id);
  if (!w) return null;
  Object.assign(w, patch, { updatedAt: Date.now() });
  await writeJson(path.join(workDir(id), 'work.json'), w);
  return w;
}

export async function deleteWork(id) {
  await rm(workDir(id), { recursive: true, force: true });
}

/* ---------------- volumes & chapters ---------------- */

export async function addVolume(workId, title) {
  const w = await getWork(workId);
  if (!w) return null;
  const vol = {
    id: crypto.randomUUID().slice(0, 8),
    title: title || `第${(w.volumes.length || 0) + 1}卷`,
    order: w.volumes.length || 0,
    chapters: [],
  };
  w.volumes.push(vol);
  w.updatedAt = Date.now();
  await writeJson(path.join(workDir(workId), 'work.json'), w);
  return vol;
}

export async function addChapter(workId, volumeId, title) {
  const w = await getWork(workId);
  if (!w) return null;
  const vol = w.volumes.find((v) => v.id === volumeId);
  if (!vol) return null;
  const id = crypto.randomUUID().slice(0, 8);
  const now = Date.now();
  const ch = {
    id,
    title: title || `第${(vol.chapters.length || 0) + 1}章`,
    order: vol.chapters.length || 0,
    wordCount: 0,
    updatedAt: now,
  };
  vol.chapters.push(ch);
  w.updatedAt = now;
  await writeJson(path.join(workDir(workId), 'work.json'), w);
  await writeChapter(workId, id, {
    id,
    title: ch.title,
    contentJson: emptyDoc(),
    text: '',
    wordCount: 0,
    updatedAt: now,
  });
  return ch;
}

export async function renameChapter(workId, chapterId, title) {
  const w = await getWork(workId);
  if (!w) return null;
  for (const v of w.volumes) {
    const c = v.chapters.find((x) => x.id === chapterId);
    if (c) {
      c.title = title;
      c.updatedAt = Date.now();
    }
  }
  w.updatedAt = Date.now();
  await writeJson(path.join(workDir(workId), 'work.json'), w);
  const data = await readChapter(workId, chapterId);
  if (data) {
    data.title = title;
    await writeChapter(workId, chapterId, data);
  }
  return true;
}

export async function deleteChapter(workId, chapterId) {
  const w = await getWork(workId);
  if (!w) return null;
  for (const v of w.volumes) {
    const i = v.chapters.findIndex((x) => x.id === chapterId);
    if (i >= 0) v.chapters.splice(i, 1);
  }
  w.updatedAt = Date.now();
  await writeJson(path.join(workDir(workId), 'work.json'), w);
  await rm(path.join(workDir(workId), 'chapters', `${chapterId}.json`), { force: true });
  await rm(path.join(workDir(workId), 'chapters', `${chapterId}.md`), { force: true });
  return true;
}

function chaptersDir(workId) {
  return path.join(workDir(workId), 'chapters');
}

export function emptyDoc() {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** 纯文本 → Tiptap 文档结构（按空行分段），AI 生成的整章用它落盘 */
export function textToDoc(text) {
  const paras = String(text || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    content: paras.length
      ? paras.map((p) => ({ type: 'paragraph', content: p ? [{ type: 'text', text: p }] : [] }))
      : [{ type: 'paragraph' }],
  };
}

export async function readChapter(workId, chapterId) {
  return readJson(path.join(chaptersDir(workId), `${chapterId}.json`));
}

/**
 * 写章节正文。同时：
 * 1) 写 .json（结构化正文）
 * 2) 写 .md（纯文本，供 Git 镜像与人工恢复）
 * 3) 按需写快照
 */
export async function writeChapter(workId, chapterId, data, { snapshot = false, snapshotTrigger = 'auto' } = {}) {
  const dir = chaptersDir(workId);
  await ensureDir(dir);
  const text = data.text ?? '';
  await writeJson(path.join(dir, `${chapterId}.json`), data);
  await writeFile(path.join(dir, `${chapterId}.md`), `# ${data.title || ''}\n\n${text}\n`, 'utf8');

  // 同步作品索引里的字数与更新时间
  const w = await getWork(workId);
  if (w) {
    for (const v of w.volumes) {
      const c = v.chapters.find((x) => x.id === chapterId);
      if (c) {
        c.wordCount = data.wordCount || 0;
        c.updatedAt = data.updatedAt || Date.now();
      }
    }
    w.updatedAt = Date.now();
    await writeJson(path.join(workDir(workId), 'work.json'), w);
  }

  if (snapshot) {
    await saveSnapshot(workId, chapterId, data, snapshotTrigger);
  }
  return data;
}

/* ---------------- snapshots ---------------- */

function snapshotDir(workId, chapterId) {
  return path.join(workDir(workId), 'snapshots', chapterId);
}

export async function saveSnapshot(workId, chapterId, data, trigger = 'auto') {
  const dir = snapshotDir(workId, chapterId);
  await ensureDir(dir);
  const ts = Date.now();
  const file = path.join(dir, `${ts}.json`);
  await writeJson(file, { ts, trigger, wordCount: data.wordCount || 0, ...data });
  // 保留最近 200 个快照，避免无限增长
  await pruneSnapshots(dir, 200);
  return ts;
}

async function pruneSnapshots(dir, keep) {
  const files = await readdir(dir).catch(() => []);
  if (files.length <= keep) return;
  const toDelete = files
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, files.length - keep);
  for (const f of toDelete) await rm(path.join(dir, f), { force: true });
}

export async function listSnapshots(workId, chapterId) {
  const dir = snapshotDir(workId, chapterId);
  const files = await readdir(dir).catch(() => []);
  const out = [];
  for (const f of files.filter((x) => x.endsWith('.json')).sort().reverse()) {
    const s = await readJson(path.join(dir, f));
    if (s) out.push({ ts: s.ts, trigger: s.trigger, wordCount: s.wordCount || 0 });
  }
  return out;
}

export async function readSnapshot(workId, chapterId, ts) {
  return readJson(path.join(snapshotDir(workId, chapterId), `${ts}.json`));
}

/* ---------------- export ---------------- */

export async function exportWorkTxt(workId) {
  const w = await getWork(workId);
  if (!w) return null;
  const parts = [];
  for (const v of w.volumes) {
    for (const c of v.chapters) {
      const d = await readChapter(workId, c.id);
      parts.push(`${c.title}\n\n${d?.text || ''}\n`);
    }
  }
  return { filename: `${w.title}.txt`, content: parts.join('\n\n') };
}

/* ---------------- settings（设定库：人物 / 世界观 / 大纲） ---------------- */

/**
 * 设定库是「作品」的附属数据，单独存 settings.json。
 * 三类实体：
 *  - characters：人物卡（含关系）
 *  - world：世界观条目（按 category 分组）
 *  - outline：大纲，自引用树（parentId，深度 ≤4），可关联到真实章节
 * 之所以和正文分开存：设定改得勤、且是 W3 AI 续写的上下文来源，
 * 单独文件便于整体读取与序列化，也避免污染 work.json。
 */

export const WORLD_CATEGORIES = [
  '力量体系', '地理', '势力', '历史', '物品', '习俗', '其他',
];

export const CHAR_ROLES = ['主角', '重要配角', '普通配角', '反派', '龙套'];

export const OUTLINE_TYPES = ['volume', 'chapter', 'beat']; // 卷纲 / 章纲 / 片段
export const OUTLINE_DEPTH_LIMIT = 4;

function defaultSettings() {
  return { characters: [], world: [], outline: [] };
}

export async function getSettings(workId) {
  const s = await readJson(path.join(workDir(workId), 'settings.json'));
  if (!s) return defaultSettings();
  return {
    characters: Array.isArray(s.characters) ? s.characters : [],
    world: Array.isArray(s.world) ? s.world : [],
    outline: Array.isArray(s.outline) ? s.outline : [],
  };
}

export async function saveSettings(workId, patch = {}) {
  if (!(await getWork(workId))) return null; // 作品不存在则不写孤立文件
  const cur = await getSettings(workId);
  const next = {
    characters: Array.isArray(patch.characters) ? patch.characters : cur.characters,
    world: Array.isArray(patch.world) ? patch.world : cur.world,
    outline: Array.isArray(patch.outline) ? patch.outline : cur.outline,
  };
  await writeJson(path.join(workDir(workId), 'settings.json'), next);
  return next;
}

/**
 * 把设定库序列化成 AI 续写的上下文前缀（W3 用）。
 * 纯本地、零成本；顺序固定：人物 → 世界观 → 大纲（树形缩进）。
 */
export async function buildSettingContext(workId) {
  const s = await getSettings(workId);
  const lines = [];

  lines.push('【人物设定】');
  if (!s.characters.length) lines.push('（暂无）');
  for (const c of s.characters) {
    const parts = [
      c.name && `姓名：${c.name}`,
      c.role && `身份：${c.role}`,
      c.personality && `性格：${c.personality}`,
      c.background && `背景：${c.background}`,
      c.motivation && `目标/动机：${c.motivation}`,
      c.weakness && `弱点/恐惧：${c.weakness}`,
    ].filter(Boolean);
    lines.push(parts.join('；'));
    if (c.relations?.length) {
      lines.push(`  关系：${c.relations.map((r) => `${r.name}（${r.type}）`).join('、')}`);
    }
  }

  lines.push('', '【世界观】');
  if (!s.world.length) lines.push('（暂无）');
  for (const w of s.world) lines.push(`（${w.category}）${w.title}：${w.content}`);

  lines.push('', '【大纲】');
  if (!s.outline.length) lines.push('（暂无）');
  const children = {};
  for (const o of s.outline) (children[o.parentId || 'root'] ||= []).push(o);
  const render = (pid, depth) => {
    for (const o of children[pid] || []) {
      const typeLabel = { volume: '卷', chapter: '章', beat: '段' }[o.type] || '';
      const words = o.targetWords ? `（约${o.targetWords}字）` : '';
      lines.push(`${'  '.repeat(depth)}- [${typeLabel}] ${o.title}${words}${o.content ? '：' + o.content : ''}`);
      render(o.id, depth + 1);
    }
  };
  render('root', 0);

  return lines.join('\n');
}

/* ---------------- stats ---------------- */

export function countWords(text) {
  if (!text) return 0;
  // 网文口径：去掉空白后的字符数（含标点）
  return text.replace(/\s/g, '').length;
}

export async function getStats() {
  const works = await listWorks();
  const total = works.reduce((s, w) => s + w.wordCount, 0);
  return { totalWords: total, workCount: works.length };
}

/* ---------------- 成书计划（一键成书向导的断点文件） ---------------- */

/**
 * 一键成书向导分阶段生成，把中间产物（选题/大纲/人物/分卷/章纲/已写标记）落盘到
 * book-plan.json，便于中途关闭后恢复、或分批续写章节。与 work.json 平级。
 */
export async function getComposePlan(workId) {
  return readJson(path.join(workDir(workId), 'book-plan.json'));
}

export async function saveComposePlan(workId, plan) {
  await writeJson(path.join(workDir(workId), 'book-plan.json'), { ...plan, updatedAt: Date.now() });
  return plan;
}

/* ---------------- AI 配置（用户可在界面自助配置，覆盖 .env） ---------------- */

/**
 * AI 配置存成 data/ai-config.json，允许用户在「AI 设置」里自助填写，
 * 不必再碰 .env。优先级：data/ai-config.json > 环境变量（便于服务器/CI 部署兜底）。
 * 注意：含密钥，已加入 .gitignore，不会被 Git 镜像提交。
 */
const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai-config.json');
const DEFAULT_AI_BASE = 'https://api.openai.com/v1';
const DEFAULT_AI_MODEL = 'gpt-4o-mini';

function maskKey(k) {
  if (!k) return null;
  if (k.length <= 6) return `${k[0]}****${k.slice(-1)}`;
  return `${k.slice(0, 3)}****${k.slice(-4)}`;
}

function readAiConfigFile() {
  try {
    return JSON.parse(readFileSync(AI_CONFIG_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

/**
 * 归一化配置 → { providers, activeId }。
 * 新格式：{ providers:[{id,name,baseURL,model,apiKey}], activeId }
 * 旧格式：{ baseURL, model, apiKey } —— 自动迁移成单条 provider，老用户无感升级。
 */
function normalizeAiConfig(f = {}) {
  const raw = Array.isArray(f.providers) ? f.providers : null;
  let providers;
  if (raw) {
    providers = raw
      .filter((p) => p && typeof p === 'object')
      .map((p, i) => ({
        id: String(p.id || `p${i + 1}`),
        name: String(p.name || '').trim() || `模型 ${i + 1}`,
        baseURL: String(p.baseURL || '').trim(),
        model: String(p.model || '').trim(),
        apiKey: String(p.apiKey || ''),
      }));
  } else if (f.baseURL || f.model || f.apiKey) {
    // 旧格式迁移
    providers = [
      {
        id: 'p1',
        name: String(f.name || '').trim() || '默认',
        baseURL: String(f.baseURL || '').trim(),
        model: String(f.model || '').trim(),
        apiKey: String(f.apiKey || ''),
      },
    ];
  } else {
    providers = [];
  }
  const activeId = providers.some((p) => p.id === f.activeId) ? f.activeId : providers[0]?.id || null;
  return { providers, activeId };
}

/**
 * 读取「生效中」的 AI 配置：activeId 指向那条 provider 优先，环境变量兜底。
 * 同步读取——每次 AI 请求都走这里，切换模型后即时生效、无需重启服务。
 */
export function loadAiConfig() {
  const { providers, activeId } = normalizeAiConfig(readAiConfigFile());
  const p = providers.find((x) => x.id === activeId) || null;
  const base = (p?.baseURL || process.env.INKDRAFT_AI_BASEURL || DEFAULT_AI_BASE).replace(/\/+$/, '');
  const model = p?.model || process.env.INKDRAFT_AI_MODEL || DEFAULT_AI_MODEL;
  const key = p?.apiKey || process.env.INKDRAFT_AI_KEY || '';
  // configured 保持「有 Key」，ready 表示「有网关+模型可发起请求」（Ollama 等本地模型无 Key 也可用）
  return {
    base,
    key,
    model,
    configured: !!key,
    ready: !!(base && model),
    activeId: activeId || null,
    activeName: p?.name || '',
  };
}

/**
 * 返回完整 provider 列表 + 生效 id（含明文 Key，仅供服务端内部使用）。
 * 文件无配置时回退到环境变量（兼容老部署）。
 */
export function loadAiProviders() {
  const { providers, activeId } = normalizeAiConfig(readAiConfigFile());
  if (providers.length) return { providers, activeId };
  const base = (process.env.INKDRAFT_AI_BASEURL || '').replace(/\/+$/, '');
  const model = process.env.INKDRAFT_AI_MODEL || '';
  const key = process.env.INKDRAFT_AI_KEY || '';
  if (base && model) {
    return {
      providers: [{ id: 'env', name: '环境变量', baseURL: base, model, apiKey: key }],
      activeId: 'env',
    };
  }
  return { providers: [], activeId: null };
}

/**
 * 切换生效模型（持久化）。只改 activeId，保留原文件里的 image 块等其它字段。
 * 返回切换后的 activeId；模型不存在或与当前相同则原样返回。
 */
export async function setActiveProvider(id) {
  const f = readAiConfigFile();
  const { providers, activeId: cur } = normalizeAiConfig(f);
  if (!providers.some((p) => p.id === id)) return cur;
  if (cur === id) return cur;
  f.activeId = id;
  await writeJson(AI_CONFIG_FILE, f);
  return id;
}

/** 对外暴露的安全视图：绝不返回明文 Key，只给掩码。 */
export function getAiConfig() {
  const { providers, activeId } = normalizeAiConfig(readAiConfigFile());
  const eff = loadAiConfig();
  const fromFile = providers.some((p) => p.baseURL || p.model || p.apiKey);
  const fromEnv =
    !fromFile && (!!process.env.INKDRAFT_AI_BASEURL || !!process.env.INKDRAFT_AI_MODEL || !!process.env.INKDRAFT_AI_KEY);
  return {
    // 生效中（active）那一台的视图，字段保持旧契约，前端无需大改
    configured: eff.configured,
    ready: eff.ready,
    source: fromFile ? 'file' : fromEnv ? 'env' : 'none',
    base: eff.base,
    model: eff.model,
    hasKey: !!eff.key,
    keyMask: maskKey(eff.key),
    // 多模型支持
    activeId: activeId || null,
    activeName: eff.activeName || '',
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseURL: p.baseURL,
      model: p.model,
      hasKey: !!p.apiKey,
      keyMask: maskKey(p.apiKey),
      ready: !!(p.baseURL && p.model),
      active: p.id === activeId,
    })),
  };
}

/** 把 patch 套用到单条 provider（空值回退默认；Key 只在显式给时才改） */
function applyToProvider(p, patch) {
  const next = { ...p };
  if (patch.name !== undefined) next.name = String(patch.name).trim() || p.name || '未命名';
  if (patch.baseURL !== undefined) next.baseURL = String(patch.baseURL).trim() || DEFAULT_AI_BASE;
  if (patch.model !== undefined) next.model = String(patch.model).trim() || DEFAULT_AI_MODEL;
  if (patch.clearKey) next.apiKey = '';
  else if (patch.apiKey !== undefined) next.apiKey = String(patch.apiKey).trim();
  return next;
}

/**
 * 保存 AI 配置，支持多模型。
 * op: 'add' | 'update' | 'delete' | 'activate'；不传 op 的旧调用（带 baseURL/model/apiKey/clearKey）
 * 一律作用于「生效中」那条，保证老接口与老数据行为不变。
 */
export async function saveAiConfig(patch = {}) {
  const { providers: curProviders, activeId: curActive } = normalizeAiConfig(readAiConfigFile());
  let providers = curProviders;
  let activeId = curActive;
  const op = patch.op;

  if (op === 'add') {
    const p = patch.provider || {};
    const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    providers = [
      ...providers,
      {
        id,
        name: String(p.name || '').trim() || `模型 ${providers.length + 1}`,
        baseURL: String(p.baseURL || '').trim(),
        model: String(p.model || '').trim(),
        apiKey: String(p.apiKey || ''),
      },
    ];
    if (patch.activate !== false && !activeId) activeId = id; // 第一条自动生效
  } else if (op === 'update') {
    const idx = providers.findIndex((x) => x.id === patch.id);
    if (idx < 0) throw new Error('要修改的模型不存在');
    providers = providers.map((x, i) => (i === idx ? applyToProvider(x, patch.provider || patch) : x));
  } else if (op === 'delete') {
    providers = providers.filter((x) => x.id !== patch.id);
    if (activeId === patch.id) activeId = providers[0]?.id || null;
  } else if (op === 'activate') {
    if (!providers.some((x) => x.id === patch.id)) throw new Error('要切换的模型不存在');
    activeId = patch.id;
  } else {
    // 兼容旧调用：更新生效中那条
    if (!providers.length) {
      providers = [{ id: 'p1', name: '默认', baseURL: '', model: '', apiKey: '' }];
      activeId = 'p1';
    }
    const idx = providers.findIndex((x) => x.id === activeId);
    const target = idx >= 0 ? idx : 0;
    providers = providers.map((x, i) => (i === target ? applyToProvider(x, patch) : x));
    activeId = providers[target].id;
  }

  await writeJson(AI_CONFIG_FILE, { activeId, providers });
  return getAiConfig();
}

/* ---------------- 图片生成（多模态）配置（多模型） ---------------- */

/**
 * 归一化图片模型配置：支持新结构 { imageProviders:[{id,name,baseURL,model,apiKey}],
 * imageActiveId }，同时兼容老的单个 { image:{enabled,baseURL,model,apiKey} }。
 * 返回 { providers, activeId }。文件里无任何配置时回退到 INKDRAFT_IMG_* 环境变量。
 */
function normalizeImageConfig(f = {}) {
  let list = Array.isArray(f.imageProviders) ? f.imageProviders : null;
  let activeId = f.imageActiveId || null;

  if (!Array.isArray(list)) {
    const legacy = f.image && typeof f.image === 'object' ? f.image : {};
    if (legacy.baseURL || legacy.model || legacy.apiKey) {
      list = [{ id: 'img1', name: legacy.name || '图片模型 1', baseURL: legacy.baseURL || '', model: legacy.model || '', apiKey: legacy.apiKey || '' }];
      activeId = 'img1';
    } else {
      list = [];
    }
  }

  list = list.map((p) => ({
    id: p.id || `img${Date.now().toString(36)}`,
    name: p.name || '图片模型',
    baseURL: String(p.baseURL || '').trim(),
    model: String(p.model || '').trim(),
    apiKey: String(p.apiKey || ''),
  }));

  // 环境变量兜底（仅当文件里没有任何配置时）
  if (!list.length && (process.env.INKDRAFT_IMG_BASEURL || process.env.INKDRAFT_IMG_MODEL)) {
    list = [{ id: 'env', name: '环境变量', baseURL: process.env.INKDRAFT_IMG_BASEURL || '', model: process.env.INKDRAFT_IMG_MODEL || '', apiKey: process.env.INKDRAFT_IMG_KEY || '' }];
    activeId = 'env';
  }

  if (!activeId || !list.some((x) => x.id === activeId)) activeId = list[0]?.id || null;
  return { providers: list, activeId };
}

/** 安全视图：绝不返回明文 Key，只给掩码。 */
export function getImageConfig() {
  const { providers, activeId } = normalizeImageConfig(readAiConfigFile());
  const eff = providers.find((p) => p.id === activeId) || providers[0] || null;
  const base = (eff?.baseURL || '').replace(/\/+$/, '');
  const model = eff?.model || '';
  const key = eff?.apiKey || '';
  return {
    enabled: !!(base && model),
    configured: !!(base && model && key),
    hasKey: !!key,
    keyMask: maskKey(key),
    base,
    model,
    activeId: activeId || null,
    activeName: eff?.name || '',
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseURL: p.baseURL,
      model: p.model,
      hasKey: !!p.apiKey,
      keyMask: maskKey(p.apiKey),
      ready: !!(p.baseURL && p.model),
      active: p.id === activeId,
    })),
  };
}

/** 服务端内部用：返回生效图片模型的完整配置（含明文 Key）。 */
export function loadImageConfig() {
  const { providers, activeId } = normalizeImageConfig(readAiConfigFile());
  const eff = providers.find((p) => p.id === activeId) || providers[0] || null;
  if (!eff) return { base: '', model: '', key: '', activeName: '' };
  return {
    base: (eff.baseURL || '').replace(/\/+$/, ''),
    model: eff.model || '',
    key: eff.apiKey || '',
    activeName: eff.name || '',
  };
}

/** 服务端内部用：返回全部图片模型完整配置（含 Key），供连通性测试按 id 取用。 */
export function getImageProviders() {
  return normalizeImageConfig(readAiConfigFile()).providers;
}

/**
 * 保存图片模型配置，支持多模型：
 *  op: 'add' | 'update' | 'delete' | 'activate'；不传 op 的旧调用（带 baseURL/model/apiKey）
 *  作用于「生效中」那条，保证老契约不变。写入时保留原文件其它字段（providers/activeId）。
 */
export async function saveImageConfig(patch = {}) {
  const f = readAiConfigFile();
  const { providers: cur, activeId: curActive } = normalizeImageConfig(f);
  let providers = cur;
  let activeId = curActive;
  const op = patch.op;

  const apply = (p, patch) => {
    const next = { ...p };
    if (patch.name !== undefined) next.name = String(patch.name).trim() || p.name || '未命名';
    if (patch.baseURL !== undefined) next.baseURL = String(patch.baseURL).trim();
    if (patch.model !== undefined) next.model = String(patch.model).trim();
    if (patch.clearKey) next.apiKey = '';
    else if (patch.apiKey !== undefined) next.apiKey = String(patch.apiKey).trim();
    return next;
  };

  if (op === 'add') {
    const p = patch.provider || {};
    const id = `img${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    providers = [...providers, { id, name: p.name || `图片模型 ${providers.length + 1}`, baseURL: p.baseURL || '', model: p.model || '', apiKey: p.apiKey || '' }];
    if (patch.activate !== false && !activeId) activeId = id; // 第一条自动生效
  } else if (op === 'update') {
    const idx = providers.findIndex((x) => x.id === patch.id);
    if (idx < 0) throw new Error('要修改的图片模型不存在');
    providers = providers.map((x, i) => (i === idx ? apply(x, patch.provider || patch) : x));
  } else if (op === 'delete') {
    providers = providers.filter((x) => x.id !== patch.id);
    if (activeId === patch.id) activeId = providers[0]?.id || null;
  } else if (op === 'activate') {
    if (!providers.some((x) => x.id === patch.id)) throw new Error('要切换的图片模型不存在');
    activeId = patch.id;
  } else {
    // 兼容旧调用：更新生效中那条
    if (!providers.length) { providers = [{ id: 'img1', name: '图片模型 1', baseURL: '', model: '', apiKey: '' }]; activeId = 'img1'; }
    const idx = providers.findIndex((x) => x.id === activeId);
    const target = idx >= 0 ? idx : 0;
    providers = providers.map((x, i) => (i === target ? apply(x, patch) : x));
    activeId = providers[target].id;
  }

  const next = { ...f, imageProviders: providers, imageActiveId: activeId };
  delete next.image; // 丢弃老的单条 image 块
  await writeJson(AI_CONFIG_FILE, next);
  return getImageConfig();
}

/* ---------------- health ---------------- */

export async function dataSize() {
  let bytes = 0;
  async function walk(dir) {
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) await walk(p);
      else {
        const st = await stat(p).catch(() => null);
        if (st) bytes += st.size;
      }
    }
  }
  await walk(DATA_DIR);
  return bytes;
}
