import React from 'react';
import { api } from '../api.js';
import { platformLabel } from './Home.jsx';
import { checkOpening } from '../lib/openingCheck.js';

const PLATFORMS = [
  { id: 'fanqie', label: '番茄' },
  { id: 'qidian', label: '起点' },
  { id: 'jinjiang', label: '晋江' },
  { id: 'qimao', label: '七猫' },
  { id: 'feilu', label: '飞卢' },
  { id: 'free', label: '自由' },
];

const CHANNELS = [
  { id: 'male', label: '男频' },
  { id: 'female', label: '女频' },
];

const GENRES = {
  male: ['都市', '玄幻', '仙侠', '奇幻', '历史', '军事', '游戏', '科幻', '悬疑', '武侠', '轻小说'],
  female: ['古代言情', '现代言情', '幻想言情', '纯爱', '悬疑推理', '种田', '宫斗', '职场', '年代'],
};

const TAGS = [
  '系统流', '签到', '神豪', '马甲', '重生', '穿越', '升级流',
  '无金手指', '逆袭', '群像', '经营', '种田', '卡牌', '无限流',
  '甜宠', '虐恋', '复仇', '团宠', '慢热', '日常',
];

/** 平台节奏预设：只是起点值，按你自己的体力改 */
const PRESET = {
  fanqie: { dailyWords: 6000, targetWords: 1500000, publishAt: 120000 },
  qidian: { dailyWords: 4000, targetWords: 2000000, publishAt: 250000 },
  jinjiang: { dailyWords: 3000, targetWords: 600000, publishAt: 100000 },
  qimao: { dailyWords: 6000, targetWords: 1500000, publishAt: 120000 },
  feilu: { dailyWords: 8000, targetWords: 1000000, publishAt: 60000 },
  free: { dailyWords: 4000, targetWords: 500000, publishAt: 0 },
};

const SCORE_ITEMS = [
  { key: 'familiarity', label: '这个题材我熟', hint: '没读过 20 本同类的，先别开' },
  { key: 'domain', label: '这个领域我了解', hint: '你的行业 / 职业 / 生活经验——写熟悉的领域，省大量搜集素材的功课' },
  { key: 'strength', label: '这个类型我擅长', hint: '言情卷就写言情，别硬卷推理——扬长避短，不为爱硬发电' },
  { key: 'stamina', label: '能撑到一百万字', hint: '权重最高——网文死于写不下去，不是死于开头差' },
  { key: 'market', label: '读者和平台爱吃', hint: '看榜单与编辑约稿方向，结合读者需求，不是看你的喜好' },
];

/** 详纲字段：按「相关设定 → 情节骨架 → 收尾与兜底」分组 */
const OUTLINE_FIELDS = [
  {
    group: '相关设定',
    items: [
      { key: 'background', label: '故事背景', rows: 3, placeholder: '大背景：世界 / 时代 / 社会环境 / 势力格局——它决定人物能做什么、不能做什么' },
      { key: 'theme', label: '主旨 / 灵魂', rows: 2, placeholder: '这本书想告诉读者什么？没有灵魂的书最后会变成水文' },
    ],
  },
  {
    group: '情节骨架',
    items: [
      { key: 'mainline', label: '主线', rows: 3, placeholder: '主角为达成目标的核心行动链' },
      { key: 'branches', label: '支线与副本', rows: 3, placeholder: '2-4 个副本，各写明「为主线提供什么」。副本不够多，就容易写不动、篇幅不够' },
      { key: 'hidden', label: '隐藏线（暗线）', rows: 2, placeholder: '前期埋、后期揭的真相。挖了坑记得埋' },
      { key: 'stages', label: '分卷推进', rows: 4, placeholder: '开局立足 → 成长 → 受挫 → 高潮，每阶段写清核心冲突与爽点' },
      { key: 'timeline', label: '时间轴', rows: 2, placeholder: '故事总跨度与关键时间节点（免得写着写着一周有八天）' },
    ],
  },
  {
    group: '收尾与兜底',
    items: [
      { key: 'ending', label: '结局设定', rows: 3, placeholder: '大结局如何收束、主角最终状态；主线和暗线都要在这里收掉' },
      { key: 'endingType', label: '结局类型', type: 'select', options: ['大团圆', '悲剧', '留悬念', '揭秘'] },
      { key: 'backup', label: '备选预案', rows: 2, placeholder: '写偏了怎么拉回主线？重要人物写死了是复活还是另起炉灶？' },
      { key: 'selling', label: '故事卖点', rows: 2, placeholder: '与同类相比的差异化与爽点' },
    ],
  },
];

/** 人物小传字段：性格成因 / 表里欲望 / 缺陷 / 弧光，防人设崩塌 */
const CHAR_FIELDS = [
  { key: 'name', label: '姓名', type: 'input', placeholder: '例：林萧' },
  { key: 'gender', label: '性别', type: 'select', options: ['男', '女', '其他'] },
  { key: 'camp', label: '阵营', type: 'select', options: ['己方', '敌方', '中性'] },
  { key: 'archetype', label: '现实原型', type: 'input', placeholder: '例：我那个白手起家的表哥' },
  { key: 'appearance', label: '外貌（简略）', type: 'input', placeholder: '外貌能反映脾气性格' },
  { key: 'personality', label: '性格', rows: 2, placeholder: '例：隐忍、记仇、对亲近的人大方' },
  { key: 'cause', label: '性格成因（自传）', rows: 2, placeholder: '他为什么变成这样？人不会无缘无故冷漠或热情' },
  { key: 'goal', label: '表面欲望', rows: 2, placeholder: '例：夺回家族企业' },
  { key: 'realGoal', label: '真实欲望', rows: 2, placeholder: '例：被父亲认可（表里欲望不同才有张力）' },
  { key: 'flaw', label: '缺陷 / 弱点', rows: 2, placeholder: '弱点要在高潮情节起反作用；优点与弱点要配套合理' },
  { key: 'habit', label: '口头禅 / 习惯动作', type: 'input', placeholder: '突出习惯能增强亲和力' },
  { key: 'arc', label: '成长弧光', rows: 2, placeholder: '结尾的心性必须与开头不同，否则这本书就没意义了' },
  { key: 'relation', label: '与主角的关系 / 纠葛', rows: 2, placeholder: '例：同父异母的兄弟，后期的对手' },
];

const VERDICT_TEXT = {
  go: '三项都站得住，可以开。别再想了，先写三章。',
  think: '勉强够。把没填的补完、把最低那项想清楚再开。',
  no: '现在开大概率会弃坑。要么换题材，要么先补素材。',
};

function n(v) {
  return Number(v) || 0;
}

export default function TopicDetail({ topic, onBack, onPatch, onStartWork, onDelete, onAiFill }) {
  const [t, setT] = React.useState(topic);
  const [naming, setNaming] = React.useState(false);
  const [bookTitle, setBookTitle] = React.useState('');
  const [cands, setCands] = React.useState([]);
  const [nameSrc, setNameSrc] = React.useState(''); // '' | 'ai' | 'local'
  const [namingBusy, setNamingBusy] = React.useState(false);
  const [titleCheck, setTitleCheck] = React.useState(null);
  const [checking, setChecking] = React.useState(false);
  const [outlineBusy, setOutlineBusy] = React.useState(false);
  const [outlineErr, setOutlineErr] = React.useState('');
  const [charBusy, setCharBusy] = React.useState(false);
  const [charErr, setCharErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [openReport, setOpenReport] = React.useState(null); // 开头技法自检结果
  const timer = React.useRef(null);

  React.useEffect(() => setT(topic), [topic]);

  /** 书名防重名：输入停顿 400ms 后查本地库 */
  React.useEffect(() => {
    const v = bookTitle.trim();
    if (!naming || !v) {
      setTitleCheck(null);
      return undefined;
    }
    let alive = true;
    setChecking(true);
    const id = setTimeout(async () => {
      try {
        const r = await api.checkTitle(v);
        if (alive) setTitleCheck(r);
      } catch {
        if (alive) setTitleCheck(null);
      } finally {
        if (alive) setChecking(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [bookTitle, naming]);

  /** 改动即存（800ms 防抖），选题卡不该有保存按钮 */
  function patch(next) {
    const merged = { ...t, ...next };
    setT(merged);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onPatch(merged.id, next), 800);
  }

  function patchPlan(next) {
    patch({ plan: { ...t.plan, ...next } });
  }
  function patchScore(key, val) {
    patch({ score: { ...t.score, [key]: val } });
  }

  function toggleTag(x) {
    const has = (t.tags || []).includes(x);
    patch({ tags: has ? t.tags.filter((v) => v !== x) : [...(t.tags || []), x] });
  }

  function setRef(i, key, val) {
    const list = [...(t.refWorks || [])];
    list[i] = { ...list[i], [key]: val };
    patch({ refWorks: list });
  }

  function setChar(i, key, val) {
    const list = [...(t.topicChars || [])];
    list[i] = { ...list[i], [key]: val };
    patch({ topicChars: list });
  }

  /** AI 起草详纲：基于选题信息出「开头 / 主线结构 / 结局」草稿，可继续手改 */
  async function aiDraftOutline() {
    setOutlineBusy(true);
    setOutlineErr('');
    try {
      const r = await api.aiOutline({
        topic: {
          logline: t.logline,
          protagonist: t.protagonist,
          hook: t.hook,
          channel: t.channel,
          genre: t.genre,
          platform: t.platform,
          tags: t.tags,
        },
      });
      patch({ detailOutline: { ...(t.detailOutline || {}), ...r } });
    } catch (e) {
      setOutlineErr(e.message || '起草失败，请重试');
    } finally {
      setOutlineBusy(false);
    }
  }

  /** AI 起草人物小传：主角 + 主要配角，已有名字的保留，空白卡片会被替换 */
  async function aiDraftChars() {
    setCharBusy(true);
    setCharErr('');
    try {
      const kept = (t.topicChars || []).filter((c) => String(c.name || '').trim());
      const r = await api.aiChars({
        topic: {
          logline: t.logline,
          protagonist: t.protagonist,
          channel: t.channel,
          genre: t.genre,
          tags: t.tags,
          detailOutline: t.detailOutline,
        },
        existing: kept.map((c) => c.name), // 已有名字传进去，让模型避开
      });
      if (!r.chars?.length) throw new Error('empty');
      const have = new Set(kept.map((c) => String(c.name).trim()));
      const fresh = r.chars.filter((c) => !have.has(String(c.name).trim()));
      patch({ topicChars: [...kept, ...fresh] });
      if (!fresh.length) setCharErr('生成的人物与现有重名，已全部跳过，再点一次试试。');
    } catch (e) {
      setCharErr(e.message || '起草失败，请重试');
    } finally {
      setCharBusy(false);
    }
  }

  function localCandidates() {
    const src = (t.protagonist || t.logline || '').replace(/[，。！？、,.!?\s]/g, '');
    const key = src.slice(0, 4) || '少年';
    const tag = (t.tags || [])[0] || '无敌';
    setCands([
      `开局${tag}，我${key}`,
      `${key}：从${tag}开始`,
      `我的${tag}有点强`,
      `重生后，我${key}`,
      `全世界都以为我${key}`,
      `${tag}之${key}传`,
    ]);
    setNameSrc('local');
  }

  /** 书名候选：优先 AI 按选题生成，失败回退本地模板 */
  async function nameCandidates() {
    setNamingBusy(true);
    try {
      const r = await api.aiNames({
        topic: {
          logline: t.logline,
          protagonist: t.protagonist,
          channel: t.channel,
          genre: t.genre,
          platform: t.platform,
          tags: t.tags,
        },
      });
      if (!r.names?.length) throw new Error('empty');
      setCands(r.names);
      setNameSrc('ai');
    } catch {
      localCandidates();
    } finally {
      setNamingBusy(false);
    }
  }

  async function startWork() {
    const title = bookTitle.trim();
    if (!title) return;
    setBusy(true);
    await onStartWork({ title, topicId: t.id });
    setBusy(false);
  }

  const sc = t.eval?.value ?? 0;
  const level = t.eval?.verdict?.level || 'think';
  const missing = [
    !t.logline?.trim() && '一句话创意',
    !t.protagonist?.trim() && '主角',
    !t.hook?.trim() && '黄金三章钩子',
    !(t.refWorks || []).length && '对标作品',
    !(t.detailOutline?.mainline?.trim() && t.detailOutline?.stages?.trim() && t.detailOutline?.ending?.trim()) &&
      '详纲（主线 / 分卷 / 结局）',
    !(t.topicChars || []).some((c) => String(c.name || '').trim()) && '人物小传',
  ].filter(Boolean);

  return (
    <div className="topic-page">
      <div className="tp-head">
        <button className="link-btn" onClick={onBack}>
          ‹ 返回
        </button>
        <input
          className="tp-title"
          value={t.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="选题名（给自己看的代号）"
        />
        <div className="spacer" />
        <button className="btn small" onClick={onAiFill} title="用 AI 补全空白字段">
          AI 补全
        </button>
        <span className={`score s-${level} big`}>
          {sc} · {t.eval?.verdict?.label}
        </span>
      </div>

      <div className="tp-body">
        <section className="tp-sec">
          <h3>一句话创意</h3>
          <textarea
            className="tp-logline"
            value={t.logline}
            onChange={(e) => patch({ logline: e.target.value })}
            placeholder="谁，陷在什么处境里，靠什么翻身？这一句定生死，写不出来就别开书。"
            rows={3}
          />
          <p className="hint">整本书都该是这句话的展开。写到后面跑偏了，回来看这句。</p>
        </section>

        <section className="tp-sec two">
          <div>
            <h3>频道与题材</h3>
            <div className="chip-row">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${t.channel === c.id ? 'on' : ''}`}
                  onClick={() => patch({ channel: c.id, genre: '' })}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="chip-row">
              {(GENRES[t.channel] || GENRES.male).map((g) => (
                <button
                  key={g}
                  className={`chip ${t.genre === g ? 'on' : ''}`}
                  onClick={() => patch({ genre: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h3>目标平台</h3>
            <div className="chip-row">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${t.platform === p.id ? 'on' : ''}`}
                  onClick={() => patch({ platform: p.id, plan: PRESET[p.id] })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="hint">
              切平台会套用该平台的节奏预设（日更 / 目标字数 / 上架字数），可直接改。
              后续 AI 续写的阈值也按这个平台走。
            </p>
          </div>
        </section>

        <section className="tp-sec">
          <h3>玩法标签</h3>
          <div className="chip-row">
            {TAGS.map((x) => (
              <button
                key={x}
                className={`chip ${(t.tags || []).includes(x) ? 'on' : ''}`}
                onClick={() => toggleTag(x)}
              >
                {x}
              </button>
            ))}
          </div>
        </section>

        <section className="tp-sec two">
          <div>
            <h3>黄金三章钩子</h3>
            <textarea
              rows={4}
              value={t.hook}
              onChange={(e) => patch({ hook: e.target.value })}
              placeholder="第一章靠什么留人？冲突是什么？读者为什么翻到第二章？"
            />
          </div>
          <div>
            <h3>主角一句话</h3>
            <input
              value={t.protagonist}
              onChange={(e) => patch({ protagonist: e.target.value })}
              placeholder="例：一个被全网嘲讽的废物"
            />
            <h3 style={{ marginTop: 14 }}>目标读者</h3>
            <input
              value={t.audience}
              onChange={(e) => patch({ audience: e.target.value })}
              placeholder="例：18–30 岁男性，爱看爽点密集的都市"
            />
          </div>
        </section>

        <section className="tp-sec">
          <h3>对标作品</h3>
          {(t.refWorks || []).map((r, i) => (
            <div className="ref-row" key={i}>
              <input
                value={r.name || ''}
                placeholder="书名"
                onChange={(e) => setRef(i, 'name', e.target.value)}
              />
              <input
                value={r.why || ''}
                placeholder="它为什么火？我要抄哪一点，避开哪一点"
                onChange={(e) => setRef(i, 'why', e.target.value)}
              />
              <button
                className="icon-btn"
                onClick={() => patch({ refWorks: t.refWorks.filter((_, k) => k !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="btn small"
            onClick={() => patch({ refWorks: [...(t.refWorks || []), { name: '', why: '' }] })}
          >
            + 加一本
          </button>
          <p className="hint">至少两本。写清「抄什么」，才不会抄成四不像。</p>
        </section>

        <section className="tp-sec">
          <h3>
            详纲
            <button className="btn small" disabled={outlineBusy} onClick={aiDraftOutline} style={{ marginLeft: 12 }}>
              {outlineBusy ? '起草中…' : 'AI 起草'}
            </button>
          </h3>
          <p className="hint">
            简纲只有个开头就没了；真正要写的是详纲——开头、正文结构、结局都想好，跟着大纲走才不会跑偏。AI
            起草后一定要自己改成你真正想写的版本。
          </p>
          {outlineErr && <p className="err">{outlineErr}</p>}
          {OUTLINE_FIELDS.map((g) => (
            <div className="ol-group" key={g.group}>
              <h4>{g.group}</h4>
              {g.items.map((f) => (
                <div className="ol-field" key={f.key}>
                  <span className="bio-k">{f.label}</span>
                  {f.type === 'select' ? (
                    <select
                      value={t.detailOutline?.[f.key] || ''}
                      onChange={(e) => patch({ detailOutline: { ...(t.detailOutline || {}), [f.key]: e.target.value } })}
                    >
                      <option value="">（未定）</option>
                      {f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : f.type === 'input' ? (
                    <input
                      value={t.detailOutline?.[f.key] || ''}
                      onChange={(e) => patch({ detailOutline: { ...(t.detailOutline || {}), [f.key]: e.target.value } })}
                      placeholder={f.placeholder}
                    />
                  ) : (
                    <textarea
                      rows={f.rows || 2}
                      value={t.detailOutline?.[f.key] || ''}
                      onChange={(e) => patch({ detailOutline: { ...(t.detailOutline || {}), [f.key]: e.target.value } })}
                      placeholder={f.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="tp-sec">
          <h3>
            人物小传
            <button className="btn small" disabled={charBusy} onClick={aiDraftChars} style={{ marginLeft: 12 }}>
              {charBusy ? '起草中…' : 'AI 起草'}
            </button>
          </h3>
          <p className="hint">
            防人设崩塌：动笔前写好小传，从现实生活找人物原型——既丰满角色，也让人物跟着自己的命运走，而不是为推剧情而写故事。
            结尾主角的心性必须与开头不同，否则这本书就没意义了。
          </p>
          {charErr && <p className="err">{charErr}</p>}
          {(t.topicChars || []).map((c, i) => (
            <div className="bio-card" key={i}>
              <div className="bio-head">
                <b>{i === 0 ? '主角' : `配角 ${i}`}</b>
                <button
                  className="icon-btn"
                  onClick={() => patch({ topicChars: t.topicChars.filter((_, k) => k !== i) })}
                >
                  ×
                </button>
              </div>
              <div className="bio-grid">
                {CHAR_FIELDS.map((f) => (
                  <label key={f.key}>
                    {f.label}
                    {f.type === 'select' ? (
                      <select value={c[f.key] || ''} onChange={(e) => setChar(i, f.key, e.target.value)}>
                        <option value="">（未定）</option>
                        {f.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : f.type === 'input' ? (
                      <input
                        value={c[f.key] || ''}
                        onChange={(e) => setChar(i, f.key, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    ) : (
                      <textarea
                        rows={f.rows || 2}
                        value={c[f.key] || ''}
                        onChange={(e) => setChar(i, f.key, e.target.value)}
                        placeholder={f.placeholder}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button className="btn small" onClick={() => patch({ topicChars: [...(t.topicChars || []), {}] })}>
            + 加一个人物
          </button>
          <p className="hint">开书时这些小传会自动进设定库，AI 续写直接引用——不用开书后再抄一遍。</p>
        </section>

        <section className="tp-sec">
          <h3>节奏规划</h3>
          <div className="plan-row">
            <label>
              目标总字数
              <input
                type="number"
                value={n(t.plan?.targetWords)}
                onChange={(e) => patchPlan({ targetWords: Number(e.target.value) })}
              />
            </label>
            <label>
              日更目标
              <input
                type="number"
                value={n(t.plan?.dailyWords)}
                onChange={(e) => patchPlan({ dailyWords: Number(e.target.value) })}
              />
            </label>
            <label>
              预计上架字数
              <input
                type="number"
                value={n(t.plan?.publishAt)}
                onChange={(e) => patchPlan({ publishAt: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>

        <section className="tp-sec">
          <h3>开书前自评</h3>
          <div className="score-box">
            {SCORE_ITEMS.map((it) => (
              <div className="score-row" key={it.key}>
                <div className="score-label">
                  <b>{it.label}</b>
                  <span className="hint">{it.hint}</span>
                </div>
                <div className="score-slider">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      className={`dot ${n(t.score?.[it.key]) === v ? 'on' : ''}`}
                      onClick={() => patchScore(it.key, v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className={`verdict v-${level}`}>
              <b>
                {sc} / 5 · {t.eval?.verdict?.label}
              </b>
              <span>{VERDICT_TEXT[level]}</span>
            </div>
          </div>
        </section>

        <section className="tp-sec">
          <h3>
            开头技法自检
            <button className="btn small" style={{ marginLeft: 12 }} onClick={() => setOpenReport(checkOpening(t))}>
              开始检查
            </button>
          </h3>
          <p className="hint">
            按知乎「黑门山」拆《我有一座冒险屋》开头的四套技巧做本地检查：香农信息论（开篇反常钩子）、搞笑三核心
            （人物好感）、马斯洛（困境焦虑）、内啡肽（情绪闭环）。不依赖 AI，秒出。
          </p>
          {openReport && (
            <div className="opening-check">
              {openReport.items.map((it) => (
                <div className={`oc-item oc-${it.status}`} key={it.key}>
                  <span className="oc-icon">{it.status === 'pass' ? '✓' : it.status === 'warn' ? '!' : '✗'}</span>
                  <div className="oc-body">
                    <b>{it.label}</b>
                    <span className="oc-tip">{it.tip}</span>
                  </div>
                </div>
              ))}
              <div className={`verdict v-${openReport.verdict.level}`}>
                <b>{openReport.verdict.label}</b>
                <span>{openReport.verdict.text}</span>
              </div>
            </div>
          )}
        </section>

        <section className="tp-sec">
          {!!missing.length && (
            <div className="note warn">
              还没想清楚：{missing.join('、')}。可以先开书，但缺的这几项往往是后来写不下去的原因。
            </div>
          )}
        </section>
      </div>

      <div className="tp-foot">
        <button className="link-btn danger" onClick={() => onDelete(t.id)}>
          放弃这个选题
        </button>
        <div className="spacer" />
        {naming ? (
          <div className="naming">
            <input
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="书名"
              autoFocus
            />
            <button className="btn small" disabled={namingBusy} onClick={nameCandidates}>
              {namingBusy ? '生成中…' : '给几个候选'}
            </button>
            <button className="btn primary" disabled={busy || !bookTitle.trim() || !!titleCheck?.duplicate} onClick={startWork}>
              {busy ? '开书中…' : '开书并写第一章'}
            </button>
          </div>
        ) : (
          <button className="btn primary" onClick={() => setNaming(true)}>
            用它开书 →
          </button>
        )}
      </div>

      {naming && (checking || titleCheck) && (
        <div className="tp-title-check">
          {checking && <span className="hint">查重中…</span>}
          {!checking && titleCheck?.duplicate && (
            <p className="err">和已有作品《{titleCheck.duplicate.title}》重名，换一个。</p>
          )}
          {!checking && !titleCheck?.duplicate && !!titleCheck?.similar?.length && (
            <p className="note warn">
              和《{titleCheck.similar[0].title}》相似度 {titleCheck.similar[0].score}%，确认不是同一本再开。
            </p>
          )}
          {!checking && titleCheck && !titleCheck.duplicate && !titleCheck.similar?.length && (
            <p className="hint">本地库没有同名书；平台是否已有，上架前自己去搜一下。</p>
          )}
        </div>
      )}

      {!!cands.length && (
        <div className="tp-cands">
          {cands.map((c, i) => (
            <button key={`${i}-${c}`} className="chip" onClick={() => setBookTitle(c)}>
              {c}
            </button>
          ))}
          <span className="hint">
            {nameSrc === 'ai'
              ? 'AI 按选题生成的，点一个直接用；不满意再点一次换个方向。'
              : 'AI 没连上，先用本地模板拼几个起手；想好名字直接改。'}
          </span>
        </div>
      )}
    </div>
  );
}
