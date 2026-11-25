import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAiConfig, loadAiProviders, setActiveProvider } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SENSITIVE_FILE = path.join(__dirname, 'sensitive.json');

/**
 * AI 适配器：兼容 OpenAI Chat Completions 协议。
 * 这样可接入任意供应商：把 INKDRAFT_AI_BASEURL 指向对应网关即可，
 * 例如 DeepSeek / 通义千问 / 智谱 / OpenRouter / 本地 Ollama(openai 兼容)。
 * 零额外依赖——只用内置 fetch。
 */
export function aiConfig() {
  // 配置来源统一走 store（界面可配，覆盖 .env）
  return loadAiConfig();
}

let _sensitiveCache = null;
export function loadSensitive() {
  if (_sensitiveCache) return _sensitiveCache;
  try {
    _sensitiveCache = JSON.parse(fs.readFileSync(SENSITIVE_FILE, 'utf8'));
  } catch {
    _sensitiveCache = { politics: [], porn: [], violence: [], spam: [] };
  }
  return _sensitiveCache;
}

/** 构造带 status 的 AI 错误（status=0 表示网络层/未归类） */
function aiErr(msg, status = 0) {
  const e = new Error(msg);
  e.status = status;
  return e;
}
/** 把 fetch 网络层异常归一成可兜底消息 */
function normalizeNetErr(e) {
  const m = (e && e.message) || String(e);
  return `网络连接失败（${m.replace(/^fetch failed:?\s*/i, '')}）`;
}

/**
 * 单次请求（单模型）。base/model/key 来自一条 provider。
 * 失败时抛出带 status 的错误，供上层判断是否可兜底。
 */
async function requestOnce(p, messages, { temperature, maxTokens, signal, json }) {
  const base = String(p.baseURL || '').replace(/\/+$/, '');
  const model = String(p.model || '').trim();
  const key = p.apiKey || '';
  if (!base || !model) throw aiErr('该模型缺少 baseURL 或 model，请检查配置', 0);

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  // Ollama：走原生 /api/chat。think:false 可真正关闭思考（思考型模型如 Qwen3 常把
  // token 全花在 reasoning 上导致 content 为空），format:'json' 可强制合法 JSON。
  if (/:11434|ollama/i.test(base)) {
    const origin = new URL(base).origin;
    const payload = {
      model,
      messages,
      stream: false,
      think: false,
      options: { temperature, num_predict: maxTokens },
    };
    if (json) payload.format = 'json';
    let resp;
    try {
      resp = await fetch(`${origin}/api/chat`, { method: 'POST', headers, body: JSON.stringify(payload), signal });
    } catch (e) {
      throw aiErr(normalizeNetErr(e), 0);
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw aiErr(`AI 请求失败 ${resp.status}: ${t.slice(0, 300)}`, resp.status);
    }
    const data = await resp.json();
    return data?.message?.content || '';
  }

  const body = { model, messages, temperature, max_tokens: maxTokens };
  // 端点归一：baseURL 可能已含完整 /chat/completions 路径（用户在设置里填了完整地址），
  // 避免重复拼接导致 404。
  const endpoint = base.toLowerCase().includes('/chat/completions')
    ? base
    : `${base}/chat/completions`;
  let resp;
  try {
    resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    throw aiErr(normalizeNetErr(e), 0);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw aiErr(`AI 请求失败 ${resp.status}: ${t.slice(0, 300)}`, resp.status);
  }
  const data = await resp.json();
  const msg = data?.choices?.[0]?.message || {};
  // 思考型模型（Qwen3 / DeepSeek-R1 等）会把思考过程放 reasoning/thinking，content 才是最终答案。
  // 优先用 content；仅当 content 为空时才退回 reasoning。
  const content = msg.content || '';
  if (content.trim()) return content.trim();
  // Agnes 的思考字段叫 reasoning_content（不是 reasoning/thinking），需一并兼容
  return (msg.reasoning_content || msg.reasoning || msg.thinking || '').trim();
}

/** json 模式下追加给模型的输出硬性约束（避免字符串内换行、括号不闭合、被截断） */
const JSON_HARD_RULE =
  '\n【JSON 输出硬性要求】① 每个字符串值必须写成单行，值内部不要出现真实换行（要分条请用「；」或「。」分隔）；' +
  '② 正文中需要引号时一律使用中文引号「」或『』，绝对不要在字符串值里出现未转义的英文双引号；' +
  '③ 不要尾随逗号、不要写注释；④ 花括号与方括号必须完整成对闭合，务必把 JSON 一次性输出完整，不要中途截断。';

/** 判断错误是否值得尝试下一个模型（额度/鉴权/服务错/网络层） */
function isFallbackable(e) {
  const s = e && e.status;
  if (!s) return true; // 无 status ⇒ fetch 网络层异常（连不通/超时/abort）
  if (s === 429) return true; // 限流 / 额度耗尽
  if (s === 401) return true; // 鉴权失败（Key 失效/欠费）
  if (s === 403) return true; // 含 insufficient_quota 等
  if (s === 408) return true; // 请求超时
  if (s >= 500 && s <= 599) return true; // 服务端错误
  return false; // 400/404/422 等视为请求格式问题，不盲目兜底
}

/** 切换生效模型（持久化）；失败仅告警，不阻断当前请求 */
async function switchActiveTo(id) {
  try {
    await setActiveProvider(id);
  } catch (e) {
    console.warn(`[AI] 切换生效模型失败（${e.message}），本次仅运行时生效`);
  }
}

/**
 * 通用对话接口，返回模型文本。Key 留空时不传 Authorization（兼容 Ollama 等本地模型）。
 * 多模型兜底：优先用「生效中」模型；额度耗尽 / 鉴权失败 / 服务 5xx / 连不通时，
 * 自动按顺序尝试其余已配置模型；一旦兜底成功即把该模型设为新的生效模型并持久化。
 *  json=true 时（Ollama 走原生接口）强制合法 JSON 输出并关闭思考。
 */
export async function chat(messages, { temperature = 0.9, maxTokens = 800, signal, json = false } = {}) {
  const { providers, activeId } = loadAiProviders();
  if (!providers.length) throw new Error('未配置任何 AI 模型，请先在「AI 设置」中添加至少一个模型');

  // json 模式：统一追加输出硬性约束，从源头减少「串里带换行 / 括号没闭合 / 被截断」这类坏输出
  if (json) {
    const list = Array.isArray(messages) ? [...messages] : [];
    const i = list.findIndex((m) => m && m.role === 'system');
    if (i >= 0) {
      if (!String(list[i].content || '').includes('字符串值必须写成单行')) {
        list[i] = { ...list[i], content: `${String(list[i].content || '')}${JSON_HARD_RULE}` };
      }
    } else {
      list.unshift({ role: 'system', content: JSON_HARD_RULE });
    }
    messages = list;
  }

  // 顺序：生效中优先，其余按列表顺序兜底
  const order = [];
  const active = providers.find((p) => p.id === activeId);
  if (active) order.push(active);
  for (const p of providers) if (p.id !== active?.id) order.push(p);

  let lastErr;
  for (let i = 0; i < order.length; i++) {
    const p = order[i];
    try {
      const text = await requestOnce(p, messages, { temperature, maxTokens, signal, json });
      if (process.env.INKDRAFT_DEBUG_JSON && json) {
        console.warn('[DBG][json raw]', String(text).slice(0, 1500));
      }
      if (i > 0) {
        // 走了兜底，切换生效模型并记日志
        await switchActiveTo(p.id);
        console.warn(`[AI] 主模型不可用，已自动切换至「${p.name}」(${p.model})`);
      }
      return text;
    } catch (e) {
      lastErr = e;
      const last = i === order.length - 1;
      if (!isFallbackable(e) || last) {
        if (last && order.length > 1) {
          e.message = `所有已配置模型均不可用（已尝试 ${order.length} 个）：${e.message}`;
        }
        throw e;
      }
      console.warn(`[AI] 模型「${p.name}」调用失败（${e.message}），自动尝试下一个兜底模型…`);
    }
  }
  throw lastErr || new Error('AI 请求失败');
}

const TONE_LABELS = {
  natural: '自然推进剧情',
  conflict: '冲突升级 / 打斗场面',
  reversal: '反转打脸',
  emotion: '情感升温',
  suspense: '悬念留白',
  climax: '高潮爆发',
};
const PLATFORM_LABELS = {
  fanqie: '番茄小说',
  qidian: '起点中文网',
  jinjiang: '晋江文学城',
  free: '通用 / 其他平台',
};

const SEP = '=====候选分隔=====';

/**
 * 续写：组装「设定 + 前文 + 意图 + 爽点 + 长度 + 平台」，一次请求要 N 个候选。
 * 关键约束写进 prompt：只出正文、不解释、不 Markdown、延续文风、推进剧情。
 */
export async function continueNovel({
  settingContext = '',
  preceding = '',
  intent = '',
  tone = 'natural',
  length = 500,
  platform = 'fanqie',
  candidates = 2,
} = {}) {
  const n = Math.max(1, Math.min(3, candidates | 0));
  const toneLabel = TONE_LABELS[tone] || TONE_LABELS.natural;
  const platformLabel = PLATFORM_LABELS[platform] || PLATFORM_LABELS.free;
  const pre = preceding.length > 1600 ? preceding.slice(-1600) : preceding;

  const system = `你是一位资深网络小说作者的写作助手。任务是根据【作品设定】和【前文】，生成下一段故事正文。
规则：
1. 严格延续前文的文风、叙事视角（默认第三人称有限视角）、节奏与世界观；不擅自加入前文没有铺垫的重大设定或新角色。
2. 只输出正文内容，不要任何解释、标题、大纲、总结，也不要出现 Markdown 符号（禁用 # * - > 等）。
3. 每一段都要推进情节或刻画人物，不水字数、不重复前文已经写过的内容。
4. 语言风格贴合${platformLabel}平台读者的阅读偏好，对话自然、描写服务于剧情。`;

  const user = `【作品设定】
${settingContext || '（暂无设定）'}

【前文（最近的内容）】
${pre || '（开篇，自由起笔即可）'}

【续写意图】${intent || '自然推进剧情'}
【爽点类型】${toneLabel}
【长度】约 ${length} 字的中文正文。

请写出 ${n} 个不同方向的续写方案，用分隔符
${SEP}
隔开。几个方案写法应有明显差异（例如一个偏对话推动、一个偏动作场面、一个偏心理描写或反转）。只输出正文本身，不要编号、不要说明文字。`;

  const text = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.9, maxTokens: Math.ceil(length * 2) + 1800 }
  );

  const parts = text
    .split(SEP)
    .map((s) => s.replace(/^\s*\d+[\.、)]\s*/, '').trim())
    .filter(Boolean);
  const list = parts.length ? parts : [text.trim()];
  return { candidates: list.slice(0, n), platform, tone };
}

/**
 * 起名 / 大纲建议等轻量 AI 工具（W3 顺手提供，复用 chat）。
 * 返回纯文本，前端自行解析。
 */
export async function aiText(prompt, { temperature = 0.8, maxTokens = 600 } = {}) {
  return chat([{ role: 'user', content: prompt }], { temperature, maxTokens });
}

/* ---------------- 选题 AI ---------------- */

const TOPIC_CHANNELS = ['male', 'female'];
const TOPIC_GENRES = {
  male: ['都市', '玄幻', '仙侠', '奇幻', '历史', '军事', '游戏', '科幻', '悬疑', '武侠', '轻小说'],
  female: ['古代言情', '现代言情', '幻想言情', '纯爱', '悬疑推理', '种田', '宫斗', '职场', '年代'],
};
const TOPIC_TAGS = ['系统流', '签到', '神豪', '马甲', '重生', '穿越', '升级流', '无金手指', '逆袭', '群像', '经营', '种田', '卡牌', '无限流', '甜宠', '虐恋', '复仇', '团宠', '慢热', '日常'];
const TOPIC_PLATFORMS = ['fanqie', 'qidian', 'jinjiang', 'qimao', 'feilu', 'free'];

/** 剥离模型常附带的 thinking / reasoning 过程，避免污染 JSON */
function stripReasoningBlocks(s) {
  return s
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/Thinking Process:[\s\S]*?(?=\n\s*\{|\{)/i, '')
    .replace(/思考过程[:：][\s\S]*?(?=\n\s*\{|\{)/, '')
    .trim();
}

/* ---------------- JSON 稳健解析 ---------------- */
/*
 * 模型输出的 JSON 常见三种坏法，之前的「第一个 { 到最后一个 }」裸切法全都扛不住：
 *   1) 字符串值里写了真实换行（多段 hook / plot 特别常见）→ JSON.parse 直接报错；
 *   2) 被 max_tokens 截断，尾部括号没闭合 → 裸切出来的片段也不合法；
 *   3) 代码块围栏、前后解释文字、思考块混在里面。
 * 这里统一做：清围栏 → 括号配对扫描取主体 → 转义串内控制字符 → 补齐未闭合结构 → 去尾随逗号。
 */

/** 清掉思考块与 Markdown 代码围栏 */
function cleanJsonText(raw) {
  let s = stripReasoningBlocks(String(raw || '').trim());
  s = s.replace(/^\s*```(?:json|jsonc|JSON)?\s*$/gm, '');
  return s.trim();
}

/** 从 start 起做括号配对扫描（跳过字符串内部），返回闭合下标；未闭合返回 -1（多半被截断） */
function findBalancedEnd(s, start) {
  let inStr = false;
  let esc = false;
  const stack = [];
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); continue; }
    if (c === '}' || c === ']') {
      if (!stack.length) return -1;
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

/**
 * 判断值字符串里的这个 `"` 是「真结束引号」还是「值里夹带的裸引号」。
 * 模型写中文正文时常把英文双引号当引号用（……沦为"无用之人"。……），
 * 只能靠后文形态猜：后面紧跟 , } ] 且再往后是新键名/新元素 → 真结束；否则当内容转义。
 */
function isRealCloseQuote(s, i, expectKey) {
  if (expectKey) return true; // 键名：引号后必跟冒号
  let j = i + 1;
  while (j < s.length && /\s/.test(s[j])) j += 1;
  if (j >= s.length) return true; // 到结尾了，当成结束
  const n = s[j];
  if (n === '}' || n === ']') return true;
  if (n === ',') {
    let k = j + 1;
    while (k < s.length && /\s/.test(s[k])) k += 1;
    const m = s[k];
    // 逗号后面是新的键名/元素，或结构即将闭合 → 真结束；后面是普通文字 → 多半是值内部的逗号
    return m === undefined || m === '"' || m === '{' || m === '[' || m === '}' || m === ']';
  }
  return false;
}

/** 单遍归一化：① 转义字符串内的裸换行/制表符等控制字符 ② 值里裸引号转义 ③ 补齐未闭合的字符串与括号 */
function normalizeJsonText(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  let expectKey = true; // 期望下一个字符串是键名还是值
  const stack = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) { out += c; esc = false; continue; }
      if (c === '\\') { out += c; esc = true; continue; }
      if (c === '"') {
        if (isRealCloseQuote(s, i, expectKey)) {
          out += c;
          inStr = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\n'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
      if (c < ' ') { out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`; continue; }
      out += c;
      continue;
    }
    if (c === '"') { out += c; inStr = true; continue; }
    if (c === ':') { out += c; expectKey = false; continue; }
    if (c === ',') { out += c; expectKey = stack[stack.length - 1] === '{'; continue; }
    if (c === '{' || c === '[') { out += c; stack.push(c); expectKey = c === '{'; continue; }
    if (c === '}' || c === ']') {
      if (!stack.length) continue; // 多余的闭括号，丢弃
      const top = stack.pop();
      out += top === '{' ? '}' : ']'; // 类型不匹配时按栈顶闭合，避免整体崩掉
      expectKey = stack[stack.length - 1] === '{';
      continue;
    }
    out += c;
  }
  if (inStr) out += '"';
  for (let i = stack.length - 1; i >= 0; i -= 1) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/** 尽力把一段文本修成合法 JSON */
function repairJson(s) {
  return normalizeJsonText(s).replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 从模型输出里稳健提取并解析 JSON（对象或数组）。
 * 成功返回解析结果；全部尝试失败返回 null，由调用方决定降级或报错。
 */
export function parseJsonLoose(raw) {
  const s = cleanJsonText(raw);
  if (!s) return null;

  const iObj = s.indexOf('{');
  const iArr = s.indexOf('[');
  const spanAt = (i) => {
    if (i < 0) return '';
    const e = findBalancedEnd(s, i);
    return e >= 0 ? s.slice(i, e + 1) : s.slice(i);
  };
  // 以「最先出现的那个结构字符」为主：截断时要修的是最外层，不能退化成内层的数组/首个对象
  const objFirst = iObj >= 0 && (iArr < 0 || iObj < iArr);
  const spans = objFirst ? [spanAt(iObj), spanAt(iArr)] : [spanAt(iArr), spanAt(iObj)];

  // 1) 原样解析：整段 → 最外层片段
  for (const t of [s, spans[0]]) {
    if (!t) continue;
    try {
      return JSON.parse(t);
    } catch {}
  }
  // 2) 修复后解析（转义串内换行 + 补齐未闭合括号 + 去尾随逗号）
  for (const t of [s, spans[0]]) {
    if (!t) continue;
    try {
      return JSON.parse(repairJson(t));
    } catch {}
  }
  // 3) 最后才退到另一种结构的片段
  for (const t of [spans[1]]) {
    if (!t) continue;
    try {
      return JSON.parse(t);
    } catch {}
    try {
      return JSON.parse(repairJson(t));
    } catch {}
  }
  return null;
}

/** 从可能被 Markdown 包裹或夹杂解释文字的模型输出里提取 JSON；失败给可读报错 */
function parseJsonSafe(text, { rawForError = '' } = {}) {
  const obj = parseJsonLoose(text);
  if (obj && typeof obj === 'object') return obj;
  const rawText = String(rawForError || text || '');
  const head = rawText.slice(0, 500);
  const tail = rawText.length > 900 ? `\n…（输出尾部）\n${rawText.slice(-300)}` : '';
  const truncated = !/[}\]]\s*$/.test(rawText.trim());
  const why = truncated
    ? '\n疑似原因：输出被模型的最大长度截断（尾部没有闭合括号）。'
    : '\n疑似原因：字符串里出现了未转义的真实换行，或混入了中文引号 / 尾随逗号。';
  throw new Error(
    `AI 返回的不是合法 JSON（已自动尝试修复仍失败）。原始内容前 500 字：\n${head}${tail}${why}\n请重试，或换一个更强的模型。`
  );
}

/** 把 AI 的自由输出收敛到合法枚举，避免前端 chip 对不上 */
function sanitizeTopic(obj, channelHint = 'male') {
  if (!obj || typeof obj !== 'object') throw new Error('AI 返回结构异常');
  const channel = TOPIC_CHANNELS.includes(obj.channel) ? obj.channel : channelHint;
  const genres = TOPIC_GENRES[channel] || TOPIC_GENRES.male;
  const rawGenre = String(obj.genre || '');
  const genre = genres.includes(rawGenre) ? rawGenre : genres.find((g) => rawGenre.includes(g)) || '';
  const platform = TOPIC_PLATFORMS.includes(obj.platform) ? obj.platform : 'fanqie';
  const tags = Array.isArray(obj.tags)
    ? obj.tags.map(String).filter((t) => TOPIC_TAGS.includes(t)).slice(0, 5)
    : [];
  const refWorks = Array.isArray(obj.refWorks)
    ? obj.refWorks
        // 兼容模型把对标回成字符串数组的情况
        .map((r) => (typeof r === 'string' ? { name: r, why: '' } : r))
        .filter((r) => r && r.name)
        .slice(0, 3)
        .map((r) => ({ name: String(r.name).slice(0, 40), why: String(r.why || '').slice(0, 80) }))
    : [];
  return {
    title: String(obj.title || '').slice(0, 30),
    logline: String(obj.logline || '').slice(0, 200),
    protagonist: String(obj.protagonist || '').slice(0, 80),
    hook: String(obj.hook || '').slice(0, 300),
    channel,
    genre,
    platform,
    tags,
    audience: String(obj.audience || '').slice(0, 60),
    refWorks,
  };
}

/** 补全模式：以已有选题为底，只把 AI 填出来的非空字段盖上去，绝不翻转作者已定的频道/平台 */
function fillMerge(current, ai) {
  const ch = (current?.channel && TOPIC_CHANNELS.includes(current.channel)) ? current.channel : ai.channel;
  return {
    title: current?.title || ai.title || '',
    logline: current?.logline?.trim() || ai.logline || '',
    protagonist: current?.protagonist?.trim() || ai.protagonist || '',
    hook: current?.hook?.trim() || ai.hook || '',
    audience: current?.audience?.trim() || ai.audience || '',
    channel: ch,
    platform: current?.platform || ai.platform || 'fanqie',
    genre: current?.genre?.trim() || ai.genre || '',
    tags: current?.tags?.length ? current.tags : ai.tags,
    refWorks: current?.refWorks?.length ? current.refWorks : ai.refWorks,
  };
}

/**
 * AI 生成选题：新选题（new）或补全（fill）。
 * 返回可直接交给 store.createTopic / updateTopic 的字段对象。
 */
export async function generateTopic({ seed = '', channel = 'male', platform = 'fanqie', mode = 'new', current = null } = {}) {
  const ch = TOPIC_CHANNELS.includes(channel) ? channel : 'male';
  const genres = (TOPIC_GENRES[ch] || TOPIC_GENRES.male).join('、');
  const tagList = TOPIC_TAGS.join('、');

  const baseRules =
    '你是资深网络小说策划/主编。只输出合法 JSON，不要任何解释文字，也不要用 Markdown 代码块包裹（直接给 JSON）。\n' +
    '字段：title(≤10字，给自己看的选题代号)、logline(一句话创意：谁，陷在什么处境里，靠什么翻身，20-40字)、' +
    'protagonist(主角一句话设定≤25字)、hook(黄金三章钩子：冲突是什么、读者为何翻第二章，40-80字)、' +
    'channel(只能 male/female)、genre(从给定题材列表选其一)、platform(只能 fanqie/qidian/jinjiang/qimao/feilu/free)、' +
    'tags(数组，从给定标签选 3-5 个)、audience(目标读者≤25字)、refWorks(数组，每项{name,why}，2-3 本对标，why 说明抄什么/避什么)。';

  let system;
  let user;
  if (mode === 'fill' && current) {
    system = baseRules + '\n当前任务是「补全」：只完善空着或明显过短的字段；已有且合理的字段原样保留，不要改写作者原意。';
    user =
      `【已有选题】\n${JSON.stringify({
        title: current.title,
        logline: current.logline,
        protagonist: current.protagonist,
        hook: current.hook,
        channel: current.channel,
        genre: current.genre,
        platform: current.platform,
        tags: current.tags,
        audience: current.audience,
        refWorks: current.refWorks,
      }, null, 2)}\n` +
      `【可选题材】${genres}\n【可选标签】${tagList}\n请返回补全后的完整选题 JSON（已有字段保持原值）。`;
  } else {
    system = baseRules + '\n当前任务是「新选题」：基于用户给的方向，生成一个当下平台有市场、能撑长篇的选题。';
    user =
      `【用户想写】${seed || '（自由发挥，给一个有市场潜力的选题）'}\n` +
      `【指定频道】${ch === 'female' ? '女频' : '男频'}\n【指定平台】${platform}\n` +
      `【可选题材】${genres}\n【可选标签】${tagList}\n请返回 JSON。`;
  }

  const text = await chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0.85, maxTokens: 4096, json: true }
  );
  // 三级兜底：① 直接解析 ② 让模型把坏输出重整理成 JSON ③ 降温重试生成一次
  // 注意：解析成功 ≠ 结果可用。若拿到的是数组或关键字段全空，同样按失败处理走兜底。
  const usable = (o) =>
    !!o && typeof o === 'object' && !Array.isArray(o) && !!(o.title || o.logline || o.hook);
  if (process.env.INKDRAFT_DEBUG_JSON) console.warn('[DBG][topic raw]', String(text).slice(0, 1200));
  let obj = usable(parseJsonLoose(text)) ? parseJsonLoose(text) : null;
  if (!obj) {
    const fixed = await chat(
      [
        {
          role: 'system',
          content:
            '你是 JSON 提取器。用户会给你一段可能是小说选题的内容（可能被截断、或字符串里有未转义换行）。请只输出合法 JSON，不要任何解释。' +
            '必须包含字段：title, logline, protagonist, hook, channel(只能male/female), genre, ' +
            'platform(只能fanqie/qidian/jinjiang/qimao/feilu/free), tags(数组), audience, refWorks(数组每项{name,why})。' +
            '内容缺失的字段按已有信息合理补全，不要留空。',
        },
        { role: 'user', content: `请把下面内容提取成上述 JSON：\n\n${String(text || '').slice(0, 6000)}` },
      ],
      { temperature: 0.1, maxTokens: 2048, json: true }
    );
    obj = usable(parseJsonLoose(fixed)) ? parseJsonLoose(fixed) : null;
  }
  if (!obj) {
    const retry = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0.4, maxTokens: 4096, json: true }
    );
    if (!usable(parseJsonLoose(retry))) {
      return parseJsonSafe(retry, { rawForError: `${text}\n\n--- 重试输出 ---\n${retry}` });
    }
    obj = parseJsonLoose(retry);
  }
  const ai = sanitizeTopic(obj, ch);
  // 用户在界面明确选了目标平台 → 新选题时强制采用，不信模型自由发挥
  if (!(mode === 'fill' && current) && TOPIC_PLATFORMS.includes(platform)) ai.platform = platform;
  if (mode === 'fill' && current) return fillMerge(current, ai);
  return ai;
}

/** 书名候选：基于选题信息生成（json 模式；失败由前端回退本地模板） */
export async function generateNames(topic = {}) {
  const seed = [
    topic.logline && `创意：${topic.logline}`,
    topic.protagonist && `主角：${topic.protagonist}`,
    topic.channel && `频道：${topic.channel === 'female' ? '女频' : '男频'}`,
    topic.genre && `题材：${topic.genre}`,
    topic.platform && `平台：${PLATFORM_LABELS[topic.platform] || topic.platform}`,
    (topic.tags || []).length && `标签：${topic.tags.join('、')}`,
  ]
    .filter(Boolean)
    .join('\n');

  const text = await chat(
    [
      {
        role: 'system',
        content:
          '你是网文书名策划。只输出合法 JSON 对象：{"names":["书名1","书名2","书名3","书名4","书名5","书名6"]}，共 6 个书名候选。书名 2-8 个字，符合该平台的起名习惯，风格要有差异（直白爽感 / 悬念钩子 / 身份反差各占一些）。不要解释，不要 Markdown。'
      },
      { role: 'user', content: `【选题信息】\n${seed || '（自由发挥）'}\n\n请按格式返回 JSON 对象。` },
    ],
    { temperature: 0.9, maxTokens: 300, json: true }
  );

  const obj = parseJsonLoose(text);
  if (!obj || typeof obj !== 'object') throw new Error('书名候选返回不是合法 JSON');
  const arr = Array.isArray(obj) ? obj : obj.names;
  if (!Array.isArray(arr)) throw new Error('书名候选返回结构异常');
  return [...new Set(arr.map((x) => String(x).trim().slice(0, 20)).filter(Boolean))].slice(0, 8);
}

/** 详纲起草：按「相关设定 / 主线支线暗线 / 分卷推进 / 结局 / 预案 / 卖点」出结构化详纲 */
export async function generateOutline(topic = {}) {
  const seed = [
    topic.logline && `创意：${topic.logline}`,
    topic.protagonist && `主角：${topic.protagonist}`,
    topic.hook && `黄金三章钩子：${topic.hook}`,
    topic.channel && `频道：${topic.channel === 'female' ? '女频' : '男频'}`,
    topic.genre && `题材：${topic.genre}`,
    topic.platform && `平台：${PLATFORM_LABELS[topic.platform] || topic.platform}`,
    (topic.tags || []).length && `标签：${topic.tags.join('、')}`,
  ]
    .filter(Boolean)
    .join('\n');

  const text = await chat(
    [
      {
        role: 'system',
        content:
          '你是资深网文主编。只输出合法 JSON 对象，字段如下（都是字符串）：' +
          'background(故事背景：大背景/世界/势力/规则，60-120字)、' +
          'theme(主旨灵魂：这本书想告诉读者什么，30-60字)、' +
          'mainline(主线：主角为达成目标的核心行动链，必须包含「起因→冲突→目标→驱动力→逻辑闭环」，80-150字)、' +
          'branches(支线与副本：2-4 个，各注明「为主线提供什么」，80-150字——必须是单个字符串，不要用数组或对象)、' +
          'hidden(隐藏线暗线：前期埋、后期揭的真相，40-80字)、' +
          'stages(分卷推进：按 开局立足→成长→受挫→高潮 分 3-5 阶段，每阶段用「起承转合」写清：主角的目标、挡路的冲突/困难、如何破局、留下什么悬念；每阶段都要有明确冲突与爽点，150-250字——必须是单个字符串，不要用数组或对象)、' +
          'timeline(时间轴：故事总跨度与关键时间节点，防止时间错乱，30-60字)、' +
          'ending(结局设定：大结局如何收束、主角最终状态，60-120字)、' +
          'endingType(只能从 大团圆/悲剧/留悬念/揭秘 中选一个)、' +
          'backup(备选预案：写偏了怎么拉回主线、重要人物写死了怎么补救，40-80字)、' +
          'selling(故事卖点：与同类相比的差异化和爽点，30-60字)。' +
          '只输出 JSON，不要解释，不要 Markdown。'
      },
      { role: 'user', content: `【选题信息】\n${seed || '（自由发挥）'}\n\n请起草详纲。` },
    ],
    { temperature: 0.85, maxTokens: 2600, json: true }
  );

  const obj = parseJsonLoose(text);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('详纲返回不是合法 JSON 对象');
  // 安全取值：模型偶尔把「支线/分卷」返回成对象数组，直接 String() 会变成 "[object Object]"
  const toText = (v, max) => {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim().slice(0, max);
    if (Array.isArray(v)) {
      const lines = v
        .map((it) => {
          if (it == null) return '';
          if (typeof it === 'string') return it;
          if (typeof it === 'object') return Object.values(it).filter((x) => x != null).join('；');
          return String(it);
        })
        .filter(Boolean);
      return lines.join('\n').slice(0, max);
    }
    if (typeof v === 'object') return Object.values(v).filter((x) => x != null).join('；').slice(0, max);
    return String(v).trim().slice(0, max);
  };
  const r = {
    background: toText(obj.background, 400),
    theme: toText(obj.theme, 200),
    mainline: toText(obj.mainline, 500),
    branches: toText(obj.branches, 500),
    hidden: toText(obj.hidden, 300),
    stages: toText(obj.stages, 800),
    timeline: toText(obj.timeline, 200),
    ending: toText(obj.ending, 400),
    endingType: ['大团圆', '悲剧', '留悬念', '揭秘'].includes(String(obj.endingType || '').trim())
      ? String(obj.endingType).trim()
      : '',
    backup: toText(obj.backup, 300),
    selling: toText(obj.selling, 200),
  };
  if (!Object.values(r).some(Boolean)) throw new Error('详纲返回为空');
  return r;
}

/** 人物小传起草：主角 + 主要配角，含性别、性格成因、真实欲望、缺陷与成长弧光 */
export async function generateChars(topic = {}, existing = []) {
  const seed = [
    topic.logline && `创意：${topic.logline}`,
    topic.protagonist && `主角一句话：${topic.protagonist}`,
    topic.channel && `频道：${topic.channel === 'female' ? '女频' : '男频'}`,
    topic.genre && `题材：${topic.genre}`,
    (topic.tags || []).length && `标签：${topic.tags.join('、')}`,
    topic.detailOutline?.mainline && `主线：${topic.detailOutline.mainline}`,
    topic.detailOutline?.theme && `主旨：${topic.detailOutline.theme}`,
  ]
    .filter(Boolean)
    .join('\n');

  // 已有人名 → 明确要求避开，避免多次起草出来一堆同名
  const avoid = existing.map((x) => String(x || '').trim()).filter(Boolean);
  const avoidLine = avoid.length ? `\n【必须避开的名字】${avoid.join('、')}——严禁与它们重复或高度相似。` : '';

  const text = await chat(
    [
      {
        role: 'system',
        content:
          '你是资深网文人物设定师。只输出合法 JSON 对象：{"chars":[{"name":"","gender":"男/女/其他","camp":"己方/敌方/中性",' +
          '"appearance":"","personality":"","cause":"性格成因（他为什么变成这样）","goal":"表面欲望","realGoal":"真实欲望",' +
          '"flaw":"缺陷弱点","habit":"口头禅或习惯动作","arc":"成长弧光（结尾与开头必须不同）","relation":"与主角的关系或纠葛"}]}，' +
          '第一个必须是主角，共 3 个人物。' +
          '命名要求：三个人物姓氏不同、字数与风格要有差异，不要用“林萧/叶凡/萧炎”这类被用烂的套路名，' +
          '名字要能体现身份（例如职场感 / 江湖感 / 年代感各不相同）。' +
          '设定要求：优点与弱点要配套合理；缺陷会在高潮情节起反作用；结尾主角心性必须与开头不同。' +
          '只输出 JSON，不要解释，不要 Markdown。'
      },
      { role: 'user', content: `【选题信息】\n${seed || '（自由发挥）'}\n${avoidLine}\n请起草人物小传。` },
    ],
    { temperature: 0.95, maxTokens: 2400, json: true }
  );

  const obj = parseJsonLoose(text);
  if (!obj || typeof obj !== 'object') throw new Error('人物小传返回不是合法 JSON');
  const arr = Array.isArray(obj) ? obj : obj.chars;
  if (!Array.isArray(arr) || !arr.length) throw new Error('人物小传返回为空');
  const pick = (v, max) => String(v || '').trim().slice(0, max);
  const seen = new Set(avoid);
  const out = [];
  for (const c of arr.slice(0, 6)) {
    const name = pick(c?.name, 20);
    if (!name || seen.has(name)) continue; // 去重：批次内 + 已有人物
    seen.add(name);
    out.push({
      name,
      gender: ['男', '女', '其他'].includes(pick(c?.gender, 4)) ? pick(c?.gender, 4) : '',
      camp: ['己方', '敌方', '中性'].includes(pick(c?.camp, 6)) ? pick(c?.camp, 6) : '己方',
      appearance: pick(c?.appearance, 200),
      personality: pick(c?.personality, 200),
      cause: pick(c?.cause, 200),
      goal: pick(c?.goal, 200),
      realGoal: pick(c?.realGoal, 200),
      flaw: pick(c?.flaw, 200),
      habit: pick(c?.habit, 100),
      arc: pick(c?.arc, 200),
      relation: pick(c?.relation, 200),
    });
  }
  if (!out.length) throw new Error('人物小传去重后为空，请重试');
  return out;
}

/* ==================== 黄金三章：AI 写前几章 ==================== */
/*
 * 技法来源（知乎「如何写好网络小说开头」多个高赞回答的共识）：
 *  1) 黑门山 · 拆《我有一座冒险屋》第一章：
 *     - 香农信息论：开篇第一句用「小概率/反常识事件」堆信息量；
 *     - 搞笑三核心：康德（角色期待因荒谬落空）+ 柏格森（读者期待被落实）+ 陈佩斯（悲情内核）；
 *     - 马斯洛需求：远忧 + 近虑 两个安全需求，再加一次尊重需求受挫；
 *     - 内啡肽：焦虑/疼痛 → 愉悦，技巧的终极目标是让读者爽。
 *  2) 花爷 · 套用模板：分题材的开头范式（都市地点介绍 / 玄幻背景设定 / 穿越一睁眼 …）。
 *  3) 匿名答主 · 新人避雷：别堆人名、主角要唯一突出、别大段堆设定、别炫技，先写不犯错的开头。
 */

const OPENING_TEMPLATES = {
  chuanyue: {
    name: '穿越重生 · 一睁眼开局',
    hint: '直接从主角穿越/重生后「一睁眼」写起，穿越前的情节尽量不写。睁眼后立刻给一个反常处境或迫在眉睫的危机。',
  },
  lingyi: {
    name: '灵异 · 反常事件开局',
    hint: '以一件不合常理的小事开场（如「这么不吓人的鬼屋我还是第一次见」），再带出主角与这个世界的规矩、危机。',
  },
  xuanhuan: {
    name: '玄幻仙侠 · 背景设定法',
    hint: '大地点由大到小快速定位（国 → 府 → 城 → 家族/宗门），两三段内引出主角，并埋一个「传奇/目标」作为前期主线锚点。',
  },
  urban: {
    name: '都市 · 地点介绍开局',
    hint: '一句点明城市/环境 → 落到具体场景（公司/学校/街道/出租屋）→ 主角出场并交代他眼下的处境。可用俗语或主角自嘲起手。',
  },
  free: {
    name: '通用 · 反常事件开局',
    hint: '第一句就抛一个小概率/反常识事件，再自然带出主角与处境，不铺陈世界观。',
  },
};

const OPENING_TECHNIQUES = [
  '香农信息论：开篇第一句就抛「小概率/反常识」事件，用信息量勾住读者',
  '马斯洛需求：背景交代里揉进「远忧 + 近虑」，再加一次尊重需求受挫，焦虑即追读动力',
  '搞笑三核心：至少一处反差段子——角色期待落空 / 读者期待落实 / 带悲情内核',
  '内啡肽闭环：每章结尾留钩子（悬念 / 小爽点 / 新危机），情绪落在揪心、爽、乐之一',
  '新人避雷：出场人物 ≤3 且姓氏好区分、主角唯一突出、设定随剧情带出、不炫技',
  '结构：开头反常钩子 → 中段推进矛盾 → 章末钩子',
];

/* ============ 知乎「花开岁寒」答主的写作技法（落地为提示词约束） ============
 * 来源：https://www.zhihu.com/question/666595706/answer/3620226316
 * 核心：场景万能公式 + 镜头感 + 「衬」式人物塑造 + 起承转合 + 冲突驱动
 */
const SCENE_FORMULA = [
  // 场景描写万能公式：时间 + 地点 + 天气 + 环境 + 路人
  '【场景万能公式】写任何场景都按序铺：① 时间+地点 ② 天气/环境 ③ 路人/旁物，把空间先立住再让主角出场。',
  // 镜头感：用路人/环境自然引出主角
  '【镜头感】让配角、路人、环境先动，再自然把镜头摇到主角身上，避免硬切；上一幕的细节（路人/物件）要在下一幕承接。',
  // 出场次序：场景 → 主角外貌+动作 → 说话 → 对方回应
  '【出场次序】主角/配角出场顺序：先外貌+动作，再说话；对方回应要带动作/神态/语言，对话不是干巴巴的引号。',
  // 「衬」式人物塑造：靠对比与细节衬托，不要直接告诉读者
  '【衬人物】人物性格靠「衬」出来：用反差角色/细节/他人的反应来烘托（如用话痨配角反衬主角沉默），禁止直接写「他很××」这类定义句。',
  // 起承转合 + 冲突驱动
  '【起承转合】每段都要有冲突：主角要干什么（目标）、被什么挡住（冲突/困难）、为什么必须做（驱动力）、如何收束（逻辑闭环），禁止平铺直叙无波无澜。',
  // 从画面出发、边想边植入困难
  '【丰富细节】从「主角此刻眼前的画面」出发往下推，随时给他植入新困难、新变量，让过程饱满、故事自己长出来。',
].join('\n');

/* ============ 通用节奏与写法（参考资料提炼，落地为提示词约束） ============
 * 来源：网文流水线写作方法论（三层大纲体系 / 爽文循环 / 正文万能公式 / 展示代替告知）
 *  - 三层大纲：总纲（全局主线/结局）→ 分卷（卷纲）→ 章纲（每章剧情），AI 必须顺着上层往下推不跑偏；
 *  - 节奏铁律：3 章一小爽、10 章一大爽，爽完缓一缓再继续；
 *  - 正文万能公式：抛矛盾 → 拉仇恨 → 主角出手 → 全场震惊 → 留钩子；
 *  - 展示代替告知：情绪写在动作与结果里，禁止「他很生气」这类定义句；
 *  - 爽文循环：遇更强对手 → 施压 → 突破 → 打脸 → 得奖励 → 更大舞台，每个循环要有一个「超出预期」的差异化元素。
 */
const COMPOSE_TECH = [
  '【正文万能公式（每章节奏）】抛矛盾 → 拉仇恨 → 主角出手 → 全场震惊 → 留钩子；节奏铁律：3 章一小爽、10 章一大爽，爽完缓一缓再继续，只虐不点炸读者会跑。',
  '【展示代替告知】禁止写「他很生气／她很紧张」这类定义句；把情绪写进动作与结果：写「他指节泛白，茶杯被捏得变形」、写「全场安静，敌人后退半步」。',
  '【爽文循环】每一段推进都是「遇到更强的对手/新的舞台 → 施压 → 修炼或谋划突破 → 打脸反转 → 获得奖励 → 更大的舞台」，且每个循环必须有一个「超出预期」的差异化元素，不能纯套路。',
  '【三层大纲】你正在写的这一章，只是「总纲 → 分卷（卷纲）→ 章纲（本章剧情蓝图）」的第三层；严格按章纲落地，不要自作主张另开主线。',
].join('\n');

/** 按题材挑开头模板 */
export function pickOpeningTemplate(topic = {}) {
  const all = [topic.genre, (topic.tags || []).join(''), topic.logline, topic.title].filter(Boolean).join(' ');
  if (/穿越|重生|转世|魂穿/.test(all)) return 'chuanyue';
  if (/灵异|恐怖|怪谈|悬疑|诡异/.test(all)) return 'lingyi';
  if (/玄幻|仙侠|修真|武侠|异界|魔法|西幻|奇幻|东方玄幻/.test(all)) return 'xuanhuan';
  if (/都市|现代|职场|校园|商战|娱乐圈|神豪|系统|异能|兵王|医生|律师/.test(all)) return 'urban';
  return 'free';
}

const CHAPTER_TASKS = {
  1: '立住主角：交代他是谁、眼下什么处境；抛出全书的主要悬念（远忧）和迫在眉睫的麻烦（近虑）；给一个让人记住他的反差小段子。',
  2: '矛盾升级：让麻烦真的落到主角头上（催债 / 被羞辱 / 被逼到绝境，尊重需求受挫）；主角第一次主动行动，但没完全解决。',
  3: '小高潮兑现：给读者第一个明确的爽点或小胜，同时抛出更大的悬念，把剧情扣回主线，让人忍不住追第四章。',
};

function openingSystemPrompt(tpl, idx, total, words) {
  return (
    '你是资深网文主编兼枪手。现在写一本网络小说的第 ' +
    idx +
    ' 章（共 ' +
    total +
    ' 章，属于决定读者去留的「黄金三章」）。\n\n' +
    '【必须遵守的开头技法】\n' +
    OPENING_TECHNIQUES.map((t, i) => `${i + 1}. ${t}`).join('\n') +
    '\n\n【本题材的开头范式】' +
    tpl.name +
    ' —— ' +
    tpl.hint +
    '\n\n【本章任务】' +
    (CHAPTER_TASKS[idx] || '推进主线矛盾，并在章末留钩子。') +
    '\n\n【写作要求】\n' +
    '- 第一句必须是「小概率/反常识」事件，不要从天气、风景、身世介绍起手。\n' +
    '- 网文节奏：短段落，多动作与对话，少形容词和抒情，不要矫情。\n' +
    '- ' + SCENE_FORMULA.replace(/\n/g, '\n- ') + '\n' +
    '- 正文 ' +
    words +
    ' 字左右。\n' +
    '- 只写这一章的正文，不要写章节序号以外的解释。\n\n' +
    '只输出合法 JSON 对象：{"title":"章节标题","text":"正文","hook":"章末钩子一句话（说明这章最后靠什么吊住读者）"}\n' +
    '不要解释，不要 Markdown 代码块。'
  );
}

function parseChapterJson(raw, idx) {
  const s = cleanJsonText(raw);
  const o = parseJsonLoose(raw);
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    const text = String(o.text || o.content || '').trim();
    if (text) {
      return {
        title: String(o.title || '').trim() || `第${idx}章`,
        text,
        hook: String(o.hook || '').trim(),
      };
    }
  }
  // 修复后仍解析不出字段：能抠出正文就抠，否则整段当正文，绝不让用户看到空章
  const m = s.match(/"(?:text|content)"\s*:\s*"([\s\S]+?)"\s*(?:,\s*"(?:hook|title)"|\}\s*$)/);
  if (m && m[1].trim()) {
    try {
      return {
        title: `第${idx}章`,
        text: JSON.parse(`"${m[1].replace(/\n/g, '\\n')}"`),
        hook: '',
      };
    } catch {}
  }
  return { title: `第${idx}章`, text: s, hook: '' };
}

/**
 * 生成前几章（黄金三章）。逐章生成，避免小模型一次输出过长崩掉；
 * 每章都把上一章的结尾带进上下文，保证连贯。
 */
export async function generateFirstChapters(topic = {}, { count = 3, words = 1200, onProgress } = {}) {
  const tplKey = pickOpeningTemplate(topic);
  const tpl = OPENING_TEMPLATES[tplKey];
  const total = Math.max(1, Math.min(3, Number(count) || 3));

  const seed = [
    topic.title && `书名/选题：${topic.title}`,
    topic.logline && `一句话创意：${topic.logline}`,
    topic.protagonist && `主角：${topic.protagonist}`,
    topic.hook && `黄金三章钩子：${topic.hook}`,
    topic.channel && `频道：${topic.channel === 'female' ? '女频' : '男频'}`,
    topic.genre && `题材：${topic.genre}`,
    (topic.tags || []).length && `标签：${topic.tags.join('、')}`,
    topic.detailOutline?.mainline && `主线：${topic.detailOutline.mainline}`,
    topic.detailOutline?.hidden && `暗线（远忧）：${topic.detailOutline.hidden}`,
    (topic.topicChars || [])
      .filter((c) => String(c?.name || '').trim())
      .slice(0, 3)
      .map((c) => `人物：${c.name}${c.gender ? `（${c.gender}）` : ''}${c.personality ? ` · ${c.personality}` : ''}`)
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  const chapters = [];
  for (let i = 1; i <= total; i += 1) {
    const prev =
      chapters.length &&
      '\n\n【前情提要】\n' +
        chapters
          .map((c, k) => `第${k + 1}章《${c.title}》结尾：${c.text.slice(-160)}`)
          .join('\n');
    const raw = await chat(
      [
        { role: 'system', content: openingSystemPrompt(tpl, i, total, words) },
        { role: 'user', content: `【选题信息】\n${seed || '（自由发挥）'}${prev || ''}\n\n请写第 ${i} 章。` },
      ],
      { temperature: 0.9, maxTokens: 2600, json: true }
    );
    chapters.push(parseChapterJson(raw, i));
    onProgress?.(i);
  }

  return { chapters, template: tpl.name, techniques: OPENING_TECHNIQUES };
}

/* ==================== 续写下一章 ==================== */

/**
 * 生成「下一章」整章（不是在当前章末尾补一段）。
 * 承接上一章结尾 + 设定库，按大纲往前推进，章末留钩子。
 */
export async function generateNextChapter({
  settingContext = '',
  prevTail = '',
  intent = '',
  words = 1200,
  platform = 'fanqie',
} = {}) {
  const tail = String(prevTail || '').slice(-1400);
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是资深网文枪手，现在要写这本书的下一章。\n\n' +
          '【要求】\n' +
          '1. 承接上文：从上一章结尾的处境/悬念接着写，不要重复已经写过的剧情，不要复述前文。\n' +
          '2. 往前推进：这一章必须让局势发生变化（新信息 / 新冲突 / 关系变化），不能原地打转。\n' +
          '3. 章末留钩子：结尾停在悬念、危机或反转上，让读者想点下一章。\n' +
          '4. 不崩人设：严格按设定库里的人物性格写，不要让角色突然变聪明/变蠢。\n' +
          '5. 网文节奏：短段落，多动作与对话，少形容词和抒情，不要注水。\n' +
          '6. 篇幅必须写满 ' + words + ' 字：这是硬指标，只写个开头就收尾视为未完成，必须把场景、对话、冲突、收尾都展开写够。\n' +
          '7. 标题只写正题名（如「火种与引信」），不要自带「第X章」这类编号，编号由程序统一生成。\n' +
          '8. 写作技法（务必遵守）：\n' + SCENE_FORMULA.replace(/\n/g, '\n') + '\n' + COMPOSE_TECH.replace(/\n/g, '\n') + '\n' +
          '9. 这一章内部也要有「起承转合」：开场承接上章钩子（起）→ 主角遇到并推进矛盾（承）→ 冲突升级/反转（转）→ 落下新的悬念（合）。\n\n' +
          '只输出合法 JSON 对象：{"title":"正题名（不含第X章编号）","text":"正文","hook":"章末钩子一句话"}\n' +
          '不要解释，不要 Markdown 代码块。',
      },
      {
        role: 'user',
        content:
          `【上一章结尾】\n${tail || '（这是第一章）'}\n\n` +
          `【设定库】\n${settingContext || '（无）'}\n\n` +
          `${intent ? `【作者指定这一章要发生】\n${intent}\n\n` : ''}` +
          '请写下一章。',
      },
    ],
    { temperature: 0.9, maxTokens: Math.ceil(words * 3) + 2000, json: true }
  );
  const r = parseChapterJson(raw, 0);
  const merged = await padChapterLength({ result: r, words, plot: intent, settingContext });
  return { ...merged, title: merged.title === '第0章' ? '' : merged.title };
}

/* ==================== 一键成书：结构化流水线 ==================== */
/*
 * 流程（用户要求的五段式，并参考网文流水线最佳实践做了优化）：
 *   书名/创意 → 故事大纲/世界观 → 小说详纲/分卷 → 章节目录/本章大概剧情 → 每章细节
 * 对应三层大纲体系：总纲（outline）→ 分卷（卷纲 volumes）→ 章纲（chapters）。
 * 每一层都由 AI 生成、可在前端编辑、再作为下一层的上下文，保证不跑偏、不烂尾。
 */

/**
 * 生成「分卷 + 卷纲」：把总纲（outline 里给的 stages 阶段）拆成若干卷。
 * 三层大纲体系的中间层：总纲已定，现在做分卷（卷纲）。
 */
// 分卷也像章纲一样分批，避免一次性要 AI 输出几十卷 JSON 被 token 截断
const VOL_BATCH = 4;

export async function generateVolumes({ topic = {}, outline = {}, targetVolumes = 3 } = {}) {
  const seed = [
    topic.title && `书名/选题：${topic.title}`,
    topic.logline && `一句话创意：${topic.logline}`,
    topic.protagonist && `主角：${topic.protagonist}`,
    topic.channel && `频道：${topic.channel === 'female' ? '女频' : '男频'}`,
    topic.genre && `题材：${topic.genre}`,
    (topic.tags || []).length && `标签：${topic.tags.join('、')}`,
    outline.mainline && `主线：${outline.mainline}`,
    outline.stages && `分卷推进（总纲里给的阶段）：${outline.stages}`,
    outline.hidden && `暗线（前期埋后期揭）：${outline.hidden}`,
    outline.ending && `结局方向：${outline.ending}${outline.endingType ? `（${outline.endingType}）` : ''}`,
  ]
    .filter(Boolean)
    .join('\n');

  const total = Math.max(2, Math.min(40, Number(targetVolumes) || 3));
  const all = [];
  let prevTail = '';
  for (let start = 0; start < total; start += VOL_BATCH) {
    const end = Math.min(start + VOL_BATCH, total);
    const batchSize = end - start;
    const isFirst = start === 0;
    const isLast = end === total;
    const posHint = isFirst
      ? '（开篇卷：铺垫世界观、立人设、抛核心矛盾）'
      : isLast
      ? '（收束卷：把主线和暗线收掉、给出主角最终状态）'
      : '（发展中卷：推进主线、升级流循环、保持爽点密度）';
    const system =
      '你是资深网文主编，正在做「分卷大纲」（三层大纲体系的中间层：总纲已定，现在拆成卷）。\n' +
      '【三层大纲体系】总纲（全局主线/结局方向）→ 分卷（卷纲）→ 章纲（每章剧情）。你现在只做分卷。\n' +
      '【每卷最少写清三件事】① 本卷目标（主角在这卷要推进什么）② 本卷 2-3 个关键事件 ③ 卷末要把角色关系/状态推到什么新位置。\n' +
      '【结构要求】\n' +
      `- 本次请只输出 ${batchSize} 卷（整体共 ${total} 卷，这是第 ${start + 1}~${end} 卷，从 1 计数）${posHint}。\n` +
      '- 升级流/循环结构（网文最常用）：每卷的舞台、对手、等级/实力要递进，且每一卷都要有一个「超出预期」的差异化元素，不能纯套路。\n' +
      '- 节奏：每 3 章安排一个小高潮（打脸/突破/收获），每 10 章左右一个大的反转（身份揭露/世界观崩塌/阵营易主）；卷末必须留大钩子或大反转。\n' +
      '- 最后一卷对应结局方向，把主线和暗线收掉。\n' +
      '【输出】只输出合法 JSON 数组，长度=' + batchSize + '，每项：' +
      '{"title":"卷名（如 第一卷·潜龙在渊）","summary":"卷纲（本卷故事走向，60-120字）",' +
      '"goal":"本卷主角目标","keyEvents":["关键事件1","关键事件2","关键事件3"],' +
      '"conflict":"本卷主要冲突/阻碍","endState":"卷末角色关系/状态变化","tone":"本卷情绪基调（压抑/热血/轻松/悬疑/悲壮…）","chaptersPerVolume":建议章数(整数15-30)}。' +
      '不要解释，不要 Markdown。';
    const userContent =
      `【总纲信息】\n${seed || '（自由发挥）'}\n\n请拆出本批次分卷大纲。` +
      (prevTail ? `\n\n【上一批卷末状态，请承接剧情】\n${prevTail}` : '');
    const text = await chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      { temperature: 0.85, maxTokens: batchSize * 800 + 1500, json: true }
    );
    const arr = parseJsonLoose(text);
    if (!Array.isArray(arr) || !arr.length) {
      throw new Error(`分卷大纲生成失败（第 ${Math.floor(start / VOL_BATCH) + 1} 批返回为空或不是合法 JSON，可重试）`);
    }
    const mapped = arr
      .filter((v) => v && (v.title || v.summary))
      .map((v, i) => ({
        title: String(v.title || `第${start + i + 1}卷`).trim().slice(0, 40),
        summary: String(v.summary || '').trim().slice(0, 400),
        goal: String(v.goal || '').trim().slice(0, 300),
        keyEvents: Array.isArray(v.keyEvents) ? v.keyEvents.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, 4) : [],
        conflict: String(v.conflict || '').trim().slice(0, 300),
        endState: String(v.endState || '').trim().slice(0, 300),
        tone: String(v.tone || '').trim().slice(0, 20),
        chaptersPerVolume: Math.max(3, Math.min(100, Number(v.chaptersPerVolume) || 15)),
      }));
    if (!mapped.length) throw new Error(`分卷大纲生成失败（第 ${Math.floor(start / VOL_BATCH) + 1} 批无有效卷，可重试）`);
    all.push(...mapped);
    const last = mapped[mapped.length - 1];
    prevTail = `上一卷：${last.title}；卷末状态：${last.endState || last.goal || ''}；基调：${last.tone || ''}`;
  }
  if (!all.length) throw new Error('分卷大纲返回为空或不是合法 JSON 数组');
  return all;
}

/**
 * 生成「章节目录 + 本章大概剧情」（章纲）：把一卷的 goal/conflict/keyEvents 摊到各章。
 * 三层大纲体系的第三层：每章写清开场场景、关键动作、结尾钩子。
 */
/*
 * 一次要 20+ 章会把输出撑爆：实测 3600 token 只够写 3 章（第 3 章连字段都没写完就被截断）。
 * 所以按批生成、跨批带上已生成章节的尾巴防止重复/断层。
 */
const PLAN_BATCH = 6;

export async function generateChapterPlan({ topic = {}, outline = {}, chars = [], volume = {}, volumeIndex = 0, totalVolumes = 1, chaptersPerVolume = 15, onProgress } = {}) {
  const seed = [
    topic.title && `书名：${topic.title}`,
    topic.logline && `创意：${topic.logline}`,
    topic.protagonist && `主角：${topic.protagonist}`,
    topic.genre && `题材：${topic.genre}`,
    outline.mainline && `全书主线：${outline.mainline}`,
    outline.ending && `结局方向：${outline.ending}`,
    (chars || [])
      .filter((c) => c && c.name)
      .slice(0, 4)
      .map((c) => `人物：${c.name}${c.role ? `（${c.role}）` : ''}${c.personality ? ` · ${c.personality}` : ''}`)
      .join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  const vol = [
    `卷名：${volume.title || ''}`,
    volume.summary && `卷纲：${volume.summary}`,
    volume.goal && `本卷目标：${volume.goal}`,
    volume.conflict && `本卷冲突：${volume.conflict}`,
    (volume.keyEvents || []).length && `本卷关键事件：${volume.keyEvents.join('；')}`,
    volume.endState && `卷末状态：${volume.endState}`,
    volume.tone && `本卷基调：${volume.tone}`,
  ]
    .filter(Boolean)
    .join('\n');

  const target = Math.max(1, Math.min(60, Number(chaptersPerVolume) || 15));
  const system =
    '你是资深网文主编，正在做「章纲」（三层大纲体系的第三层：总纲 → 分卷 → 章纲）。\n' +
    '【章纲要写清三件事】每一章：① 开场在哪里（场景）② 要完成哪几个关键动作（核心事件）③ 结尾留什么追读钩子。\n' +
    '【把本卷的 goal/conflict/keyEvents 摊到各章】逐章推进，不能空转、不能重复前文。\n' +
    '【节奏铁律】每 3 章一个小高潮（打脸/突破/收获），本卷内至少一次大反转或卷末高潮；末章必须落到「卷末状态」并留承上启下的大钩子。\n' +
    '【黄金三章（仅当这是第一卷）】前几章遵循：主角落难 → 金手指/能力上线 → 当场小反击 → 结尾扔悬念。\n' +
    '【展示代替告知】plot 写「做了什么、发生了什么冲突」，别写「他很生气」这种定义句。\n' +
    '【输出】只输出合法 JSON 数组，长度=本批要求的章数，每项：' +
    '{"title":"正题名（不含第X章编号）","plot":"本章大概剧情 150-220 字：开场场景+关键动作+结尾钩子",' +
    '"words":建议字数(整数,800-1500),"hook":"章末钩子一句话","beat":"本章在卷内位置（开篇/发展/小高潮/转折/卷末高潮）"}。' +
    '不要解释，不要 Markdown。';

  const results = [];
  for (let offset = 0; offset < target; offset += PLAN_BATCH) {
    const n = Math.min(PLAN_BATCH, target - offset);
    // 带上前几章的尾巴，保证跨批连贯、不重复剧情
    let prev = '';
    if (results.length) {
      const recent = results.slice(-4);
      const startNo = results.length - recent.length + 1;
      prev =
        '\n\n【本卷已生成的前几章（严禁重复，请接着往下推进）】\n' +
        recent.map((c, k) => `第${startNo + k}章《${c.title}》：${String(c.plot || '').slice(0, 70)}`).join('\n');
    }
    const tailNote =
      offset + n >= target
        ? '\n注意：这是本卷最后一批，末章必须落到「卷末状态」并留承上启下的大钩子。'
        : '';

    const text = await chat(
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            `【全书信息】\n${seed || '（自由发挥）'}\n\n【本卷信息】\n${vol}\n\n` +
            `这是第 ${volumeIndex + 1}/${totalVolumes} 卷，本卷共 ${target} 章。` +
            `请只生成本卷第 ${offset + 1} ~ ${offset + n} 章（共 ${n} 章）的章纲。${prev}${tailNote}`,
        },
      ],
      // 每章按 ~900 token 预留（含思考型模型的推理开销），避免再次被截断
      { temperature: 0.88, maxTokens: n * 900 + 1200, json: true }
    );

    const arr = parseJsonLoose(text);
    if (!Array.isArray(arr) || !arr.length) {
      if (!results.length) {
        throw new Error(`章纲返回为空或不是合法 JSON 数组（第 ${offset + 1} 章起就没生成出来）`);
      }
      console.warn(`[AI] 章纲在第 ${offset + 1} 章处失败，保留已生成的前 ${results.length} 章`);
      break;
    }
    for (const c of arr.slice(0, n)) {
      if (!c || (!c.title && !c.plot)) continue;
      results.push({
        title: String(c.title || `第${results.length + 1}章`).trim().slice(0, 40),
        plot: String(c.plot || '').trim().slice(0, 500),
        words: Math.max(600, Math.min(2000, Number(c.words) || 1200)),
        hook: String(c.hook || '').trim().slice(0, 120),
        beat: String(c.beat || '').trim().slice(0, 20),
      });
    }
    onProgress?.(results.length, target);
  }

  if (!results.length) throw new Error('章纲返回为空或不是合法 JSON 数组');
  return results;
}

/** 统计正文字数（不计空白） */
function countCn(s) {
  return String(s || '').replace(/\s/g, '').length;
}

/** 取「第 flatK 个非空白字符之后」的子串，用于按去空白后的下标切原文（保留段落换行） */
function sliceFromFlat(s, flatK) {
  if (flatK <= 0) return s;
  let c = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (!/\s/.test(s[i])) {
      c += 1;
      if (c === flatK) return s.slice(i + 1);
    }
  }
  return '';
}

/**
 * 正文长度补齐：模型常「写个开头就收尾」——实测要求 1200 字只给 300~600 字，
 * 且 JSON 结构完整（并非被截断），纯属模型主动停笔。
 * 这里把已写内容当前文，要求接着往下写，最多补 2 轮。
 */
async function padChapterLength({ result, words, plot = '', settingContext = '', chapterTitle = '', maxRounds = 2 }) {
  let cur = result;
  for (let i = 0; i < maxRounds; i += 1) {
    const have = countCn(cur.text);
    if (have >= words * 0.85) break;
    const need = Math.ceil(words - have);
    const more = await chat(
      [
        {
          role: 'system',
          content:
            '你是网文枪手。下面是一章小说已经写好的部分，请【接着往下写】，把这一章写完。\n' +
            '【硬性要求】① 只输出「新增」的正文，绝对不要重复、复述或改写已写部分，从已写内容结束的地方自然接续；' +
            '② 不要写标题、不要写章节编号；③ 继续推进剧情，章末必须留悬念钩子；' +
            '④ 文风、人称、节奏与已写部分保持一致。\n' +
            (chapterTitle ? `【本章标题】${chapterTitle}\n` : '') +
            (plot ? `【本章章纲（还没落地的部分要补上）】${plot}\n` : '') +
            (settingContext ? `【设定库】${settingContext}\n` : ''),
        },
        {
          role: 'user',
          content:
            `【已写部分（不要重复）】\n${cur.text}\n\n` +
            `【任务】已写 ${have} 字，目标 ${words} 字。请接着写约 ${Math.ceil(need * 1.15)} 字，把这一章写完。\n` +
            '只输出 JSON：{"text":"接着写的新增正文"}',
        },
      ],
      { temperature: 0.9, maxTokens: Math.ceil(need * 3) + 1500, json: true }
    );
    const parsed = parseJsonLoose(more);
    let add = (typeof parsed === 'string' ? parsed : String(parsed?.text || parsed?.content || '')).trim();
    if (!add) break;

    // 模型偶尔把整章重写一遍再续写 → 砍掉重复部分，只留新增
    const flatAdd = add.replace(/\s/g, '');
    const tailMark = cur.text.slice(-60).replace(/\s/g, '');
    if (tailMark.length > 20 && flatAdd.includes(tailMark)) {
      add = sliceFromFlat(add, flatAdd.indexOf(tailMark) + tailMark.length);
    } else {
      const headMark = cur.text.slice(0, 40).replace(/\s/g, '');
      if (headMark.length > 20 && flatAdd.startsWith(headMark)) {
        add = sliceFromFlat(add, countCn(cur.text));
      }
    }
    if (!add || !add.trim()) break;
    cur = { ...cur, text: `${cur.text}\n\n${add.trim()}` };
  }
  return cur;
}

/**
 * 生成「每章细节」：按章纲（plot 剧情蓝图）写出这一章的完整正文。
 * 复用 SCENE_FORMULA + COMPOSE_TECH（正文万能公式 / 展示代替告知 / 爽文循环）。
 */
export async function generateChapterFromPlan({ settingContext = '', plot = '', volumeSummary = '', tone = '', prevTail = '', words = 1200, platform = 'fanqie', chapterTitle = '' } = {}) {
  const tail = String(prevTail || '').slice(-1400);
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是资深网文枪手，现在按「章纲（本章剧情蓝图）」写这一章的正文。\n\n' +
          (chapterTitle ? `【本章指定标题（直接采用，不要改写，也不要另加第X章编号）】${chapterTitle}\n` : '') +
          '【章纲（必须落地）】\n' + String(plot || '（自由发挥）') + '\n' +
          (volumeSummary ? `【本卷卷纲】${volumeSummary}\n` : '') +
          (tone ? `【本卷情绪基调】${tone}\n` : '') +
          '【写作要求】\n' +
          '1. 严格按章纲落地：开场场景、关键动作、结尾钩子都要写进正文，不要跑题、不要复述前文。\n' +
          '2. 章纲里的「结尾钩子」必须在章末兑现，让读者想点下一章。\n' +
          '3. 往前推进：这一章要让局势发生变化（新信息/新冲突/关系变化），不能原地打转。\n' +
          '4. 不崩人设：严格按设定库人物性格写。\n' +
          '5. 正文万能公式（每章节奏）：抛矛盾 → 拉仇恨 → 主角出手 → 全场震惊 → 留钩子。\n' +
          '6. 展示代替告知：别写「他很生气」，写「他指节泛白，茶杯被捏得变形」；情绪写在动作和结果里。\n' +
          '7. 网文节奏：短段落，多动作与对话，少形容词和抒情，不注水。\n' +
          '8. 篇幅必须写满 ' + words + ' 字：这是硬指标，只写个开头就收尾视为未完成，必须把场景、对话、冲突、收尾都展开写够。\n' +
          '9. 标题只写正题名（不含第X章编号），编号由程序统一生成。\n' +
          '10. 写作技法（务必遵守）：\n' + SCENE_FORMULA.replace(/\n/g, '\n') + '\n' + COMPOSE_TECH.replace(/\n/g, '\n') + '\n' +
          '11. 本章内部也要有「起承转合」：开场承接上章钩子（起）→ 主角遇到并推进矛盾（承）→ 冲突升级/反转（转）→ 落下新的悬念（合）。\n\n' +
          '只输出合法 JSON 对象：{"title":"正题名（不含第X章编号）","text":"正文","hook":"章末钩子一句话"}\n' +
          '不要解释，不要 Markdown 代码块。',
      },
      {
        role: 'user',
        content:
          `【上一章结尾】\n${tail || '（这是第一/新章）'}\n\n` +
          `【设定库】\n${settingContext || '（无）'}\n\n` +
          '请按上面的章纲写这一章。',
      },
    ],
    // 按字数给足预算（中文 1 字≈1.5 token，再给思考型模型留一倍推理开销）
    { temperature: 0.9, maxTokens: Math.ceil(words * 3) + 2000, json: true }
  );
  const r = parseChapterJson(raw, 0);
  const merged = await padChapterLength({
    result: r,
    words,
    plot,
    settingContext,
    chapterTitle,
  });
  return { ...merged, title: merged.title === '第0章' ? (chapterTitle || '') : merged.title };
}

/* ==================== 稿件审阅 ==================== */

const REVIEW_DIMS = [
  { key: 'hook', label: '开头钩子', hint: '开篇是否勾得住人、有没有反常/悬念' },
  { key: 'pacing', label: '节奏', hint: '推进是否干脆、有无拖沓注水' },
  { key: 'character', label: '人物一致', hint: '性格/动机是否前后一致、有没有崩人设' },
  { key: 'dialogue', label: '对话', hint: '是否自然、是否推动剧情或暴露性格' },
  { key: 'conflict', label: '冲突爽点', hint: '矛盾是否明确、有没有给到读者情绪价值' },
  { key: 'style', label: '文笔', hint: '用词重复、语病、错别字、标点与段落' },
];

/**
 * 网文编辑视角的稿件审阅（区别于自检：自检查敏感词/AI占比等机械项，这里评内容）。
 * 返回六维评分 + 总评 + 优点 + 分级问题（每条都要具体、可改）。
 */
export async function reviewText({ text = '', chapterTitle = '', isOpening = false, settingContext = '' } = {}) {
  const body = String(text || '').slice(0, 6000); // 长文截断，避免爆 token
  if (!body.trim()) throw new Error('没有可审阅的内容');

  const raw = await chat(
    [
      {
        role: 'system',
        content:
          '你是资深网文编辑，正在给作者做稿件审阅。你会直说问题，但每条问题都必须给出具体改法。\n\n' +
          '【审阅维度】\n' +
          REVIEW_DIMS.map((d, i) => `${i + 1}. ${d.label}（${d.hint}）`).join('\n') +
          '\n\n' +
          (isOpening
            ? '【额外检查】这是前三章，务必检查：第一句是不是"小概率/反常识"事件、有没有给主角制造远忧与近虑、出场人物是否过多难分辨、章末有没有钩子。\n\n'
            : '') +
          '【输出要求】\n' +
          '- 每维打 1-5 分；\n' +
          '- 问题分三档：high（必须改，会劝退读者）/ mid（建议改）/ low（锦上添花）；\n' +
          '- 每条问题必须指出"具体出在哪"并给出"怎么改"，禁止空泛评价（如"节奏不太好"）；\n' +
          '- 优点要真实，不要为了凑数硬夸。\n\n' +
          '只输出合法 JSON 对象：{"scores":{"hook":n,"pacing":n,"character":n,"dialogue":n,"conflict":n,"style":n},' +
          '"summary":"一句话总评","good":["..."],"issues":[{"level":"high|mid|low","point":"问题出在哪","suggestion":"怎么改"}]}\n' +
          '不要解释，不要 Markdown 代码块。',
      },
      {
        role: 'user',
        content:
          `【章节】${chapterTitle || '（未命名）'}\n\n【正文】\n${body}\n\n` +
          `${settingContext ? `【设定库（用于检查是否跑偏/崩人设）】\n${settingContext}\n\n` : ''}` +
          '请审阅。',
      },
    ],
    { temperature: 0.5, maxTokens: 1800, json: true }
  );

  const o = parseJsonLoose(raw);
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    const scores = {};
    for (const d of REVIEW_DIMS) {
      const v = Number(o?.scores?.[d.key]);
      scores[d.key] = Number.isFinite(v) && v >= 1 && v <= 5 ? Math.round(v) : 0;
    }
    const issues = Array.isArray(o?.issues)
      ? o.issues
          .filter((x) => x && (x.point || x.suggestion))
          .map((x) => ({
            level: ['high', 'mid', 'low'].includes(String(x.level || '')) ? String(x.level) : 'mid',
            point: String(x.point || '').trim().slice(0, 400),
            suggestion: String(x.suggestion || '').trim().slice(0, 400),
          }))
      : [];
    return {
      scores,
      dims: REVIEW_DIMS,
      summary: String(o?.summary || '').trim().slice(0, 300),
      good: Array.isArray(o?.good) ? o.good.map((x) => String(x || '').trim().slice(0, 300)).filter(Boolean) : [],
      issues,
      truncated: String(text || '').length > 6000,
    };
  }
  // 降级：模型没吐出合法 JSON 时，把整段当总评，别让用户看到空白
  {
    const s = cleanJsonText(raw);
    return {
      scores: null,
      dims: REVIEW_DIMS,
      summary: s.slice(0, 1200) || '模型返回无法解析，再试一次',
      good: [],
      issues: [],
      truncated: String(text || '').length > 6000,
    };
  }
}

/* ---------------- 封面图生成（多模态 / 文生图） ---------------- */

/**
 * 文生图：兼容两类网关。
 *  - 通用 OpenAI 兼容（OpenAI、多数网关、本地 ComfyUI/SD）：`response_format` 顶层、`n`。
 *  - Agnes Image 2.5 Flash：模型名/网关含 "agnes" 时走 Agnes 协议——`response_format`
 *    必须放在 `extra_body` 内（顶层 placement 会被忽略并告警），图生图走 `extra_body.image`。
 * 返回 PNG 的 base64 字符串（不含 data: 前缀），或图像 URL（部分网关/未要求 b64 时）。
 */
export async function generateImage(prompt, { base, key, model, size = '1024x1024', ratio, image, signal } = {}) {
  if (!base || !model) throw new Error('图片模型未配置（需要多模态文生图模型，普通对话模型不行）');
  const isAgnes = /agnes/i.test(base) || /agnes/i.test(model);
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  // 端点归一：baseURL 可能已含 /images/generations（用户在设置里填了完整路径），避免重复拼
  let endpoint = base.replace(/\/+$/, '');
  if (!endpoint.toLowerCase().includes('/images/generations')) endpoint += '/images/generations';

  let body;
  if (isAgnes) {
    body = { model, prompt, size };
    if (ratio) body.ratio = ratio; // 与档位式 size 配合，如 "2K" + "3:4"
    const extra = { response_format: 'b64_json' };
    if (image) extra.image = Array.isArray(image) ? image : [image]; // 图生图/多图合成
    body.extra_body = extra;
  } else {
    body = { model, prompt, n: 1, size, response_format: 'b64_json' };
    if (image) body.image = Array.isArray(image) ? image : [image];
  }

  const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw new Error(`图片生成请求失败 ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const d0 = data?.data?.[0] || {};
  const b64 = d0.b64_json || d0.url || '';
  if (!b64) throw new Error('图片接口未返回图像数据');
  // 若返回的是 url（部分网关），直接透传；base64 则补前缀
  if (b64.startsWith('http')) return b64;
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

/**
 * 测试图片模型连通性：真正发起一次最小文生图请求（超时可控），用于「测试连通性」按钮。
 * 返回 { ok, model, ms, status?, error? }。不抛出。
 */
export async function testImageConnection({ base, key, model, timeout = 60000 } = {}) {
  if (!base || !model) return { ok: false, error: '缺少网关（Base URL）或模型名' };
  const isAgnes = /agnes/i.test(base) || /agnes/i.test(model);
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  let endpoint = String(base).replace(/\/+$/, '');
  if (!endpoint.toLowerCase().includes('/images/generations')) endpoint += '/images/generations';

  const body = isAgnes
    ? { model, prompt: 'connectivity test, a tiny simple icon', size: '1K', extra_body: { response_format: 'b64_json' } }
    : { model, prompt: 'connectivity test, a tiny simple icon', n: 1, size: '1024x1024', response_format: 'b64_json' };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const ms = Date.now() - t0;
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${t.slice(0, 300)}`, ms };
    }
    const data = await resp.json().catch(() => ({}));
    const d0 = data?.data?.[0] || {};
    if (d0.b64_json || d0.url) return { ok: true, model, ms };
    return { ok: false, status: resp.status, error: '接口返回 200，但未包含图像数据（b64_json / url 缺失）', ms };
  } catch (e) {
    const ms = Date.now() - t0;
    let err = e?.message || String(e);
    if (e?.name === 'AbortError') err = `连接超时（>${timeout}ms），请检查网络或网关地址`;
    else if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(err)) err = `无法连接服务：${err}`;
    return { ok: false, error: err, ms };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 测试对话模型连通性：真正发起一次最小 Chat 请求（超时可控），用于「测试模型是否可用」按钮。
 * 返回 { ok, model, ms, status?, error? }。不抛出。
 */
export async function testChatConnection({ base, key, model, timeout = 60000 } = {}) {
  if (!base || !model) return { ok: false, error: '缺少网关（Base URL）或模型名' };
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  // 端点归一：baseURL 可能已含 /chat/completions（用户在设置里填了完整路径），避免重复拼接
  const baseNorm = String(base).replace(/\/+$/, '');
  const endpoint = baseNorm.toLowerCase().includes('/chat/completions')
    ? baseNorm
    : `${baseNorm}/chat/completions`;

  const body = {
    model,
    messages: [{ role: 'user', content: '连通性测试：请用一句话回复"ok"。' }],
    // 思考型模型（如 agnes-2.5-flash）会把 token 全花在推理上（实测 109 个 token 里 95 个是推理），
    // 给太小会导致推理占满额度、content 为空，误报「不可用」
    max_tokens: 512,
    temperature: 0.2,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const ms = Date.now() - t0;
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, error: `HTTP ${resp.status}: ${t.slice(0, 300)}`, ms };
    }
    const data = await resp.json().catch(() => ({}));
    const msg0 = data?.choices?.[0]?.message || {};
    // 思考型模型把思考过程放 reasoning/thinking，content 才是最终答案；仅当都为空才判失败
    const content = String(msg0.content || msg0.reasoning || msg0.thinking || '').trim();
    if (content) return { ok: true, model, ms };
    return { ok: false, status: resp.status, error: '接口返回 200，但未包含有效回复内容', ms };
  } catch (e) {
    const ms = Date.now() - t0;
    let err = e?.message || String(e);
    if (e?.name === 'AbortError') err = `连接超时（>${timeout}ms），请检查网络或网关地址`;
    else if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(err)) err = `无法连接服务：${err}`;
    return { ok: false, error: err, ms };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 根据作品信息自动拼装封面提示词（中文，适用于国内文生图模型）。
 * 风格统一：小说封面、电影感、主视觉、无文字。
 */
export function buildCoverPrompt(work = {}, settings = {}, topic = null) {
  const title = work.title || '未命名作品';
  const genre = work.genre || settings?.genre || '';
  const channel = work.channel || (topic?.channel === 'female' ? '女频' : '男频');
  const keywords = [];
  // 主角的外观/气质
  const main = Array.isArray(settings?.characters) ? settings.characters.find((c) => c.role === '主角' || c === settings.characters[0]) : null;
  if (main) {
    if (main.appearance) keywords.push(main.appearance.slice(0, 40));
    if (main.personality) keywords.push(main.personality.slice(0, 20));
  }
  // 题材/世界观
  if (settings?.world?.length) {
    const w0 = settings.world[0];
    if (w0?.name) keywords.push(`${w0.name}`);
    if (w0?.desc) keywords.push(w0.desc.slice(0, 30));
  }
  const keyLine = keywords.length ? `，画面元素：${keywords.slice(0, 3).join('、')}` : '';
  const genreLine = genre ? `，题材：${genre}` : '';
  const chanLine = channel ? `，适配${channel}审美` : '';
  return (
    `小说《${title}》封面插画，电影感主视觉，精致厚涂风格，构图聚焦、氛围感强、光影层次丰富，` +
    `画面中无文字无标题${genreLine}${chanLine}${keyLine}。`
  );
}
