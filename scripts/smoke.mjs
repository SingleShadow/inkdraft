/**
 * 冒烟测试：启动服务 → 建作品 → 写章 → 快照 → 导出 → 清理。
 * 运行：node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { rm, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;

/** 用临时数据目录，绝不碰真实稿件 */
const TMP_DATA = await mkdtemp(path.join(tmpdir(), 'inkdraft-smoke-'));
// 冒烟进程内的 AI 单测也必须隔离：不读真实 ai-config（可能指向本地 Ollama），走桩可拦截的普通网关
process.env.INKDRAFT_DATA = TMP_DATA;
process.env.INKDRAFT_AI_BASEURL = 'http://smoke-stub.test/v1';

function check(name, cond, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failed += 1;
}

const child = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), INKDRAFT_DATA: TMP_DATA },
  stdio: 'ignore',
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUp() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/meta`);
      if (r.ok) return true;
    } catch {}
    await wait(250);
  }
  return false;
}

async function j(url, options) {
  const r = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const raw = await r.text();
  let data = null;
  try { data = JSON.parse(raw); } catch { /* 非 JSON，保留原文 */ }
  return { status: r.status, data, text: raw };
}

try {
  console.log('\n墨稿 InkDraft · 冒烟测试\n');
  check('服务启动', await waitUp());

  const meta = await j('/api/meta');
  check('GET /api/meta', meta.status === 200, `dailyGoal=${meta.data?.meta?.dailyGoal}`);

  /* ---- 选题：作品的上游 ---- */
  const t0 = await j('/api/topics', {
    method: 'POST',
    body: JSON.stringify({ title: '签到神豪', logline: '一个被全网嘲讽的废物，每天签到都能拿到一件神级物品。' }),
  });
  const topic = t0.data;
  check('POST /api/topics', t0.status === 200 && !!topic?.id, `id=${topic?.id}`);
  check('选题默认进灵感池', topic?.status === 'idea');

  const t1 = await j(`/api/topics/${topic.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      genre: '都市',
      tags: ['签到', '神豪'],
      platform: 'fanqie',
      plan: { targetWords: 1500000, dailyWords: 6000 },
      score: { familiarity: 5, stamina: 4, market: 4, domain: 4, strength: 4 },
      detailOutline: {
        background: '现代都市，豪门林立的商战舞台',
        theme: '普通人也能靠坚持翻身',
        mainline: '签到积累第一桶金 → 商战崛起 → 登顶',
        branches: '副本1：拍卖行捡漏（提供资金）；副本2：旧厂改造（提供班底）',
        hidden: '家族百年前侵吞产业的秘密',
        stages: '立足（打脸家族）→ 成长（商战）→ 受挫（资金链断裂）→ 高潮（并购战）',
        timeline: '全书跨度三年',
        ending: '登顶后把资产转为基金会',
        endingType: '大团圆',
        backup: '写偏了就把场景拉回签到任务',
        selling: '签到爽点 + 商战智斗双线',
      },
      topicChars: [
        {
          name: '林渊',
          camp: '己方',
          gender: '男',
          archetype: '隔壁那个卷王同事',
          appearance: '瘦高，眼下常年青黑',
          personality: '隐忍记仇',
          cause: '少年时家道中落，被亲戚当面羞辱',
          goal: '夺回家族企业',
          realGoal: '被父亲认可',
          flaw: '多疑，不敢信人',
          habit: '紧张时转戒指',
          arc: '从不敢信人到学会把背后交出去',
          relation: '主角本人',
        },
        { name: '苏晚', camp: '中性', gender: '女', archetype: '大学室友', personality: '外冷内热', goal: '查明真相', flaw: '固执', arc: '学会放手' },
      ],
    }),
  });
  check('PUT 选题（含 plan / score 合并）', t1.data?.genre === '都市' && t1.data?.plan?.dailyWords === 6000);
  check(
    '评分加权正确（五问：5*.2+4*.3+4*.2+4*.15+4*.15=4.2）',
    t1.data?.eval?.value === 4.2,
    `实际 ${t1.data?.eval?.value}`
  );
  check('评分给出结论', t1.data?.eval?.verdict?.level === 'go', t1.data?.eval?.verdict?.label);

  const tlist = await j('/api/topics');
  check('GET /api/topics 带评分', (tlist.data?.topics?.length || 0) === 1 && !!tlist.data.topics[0].eval);

  const created = await j('/api/works', {
    method: 'POST',
    body: JSON.stringify({ title: '冒烟测试作品', topicId: topic.id }),
  });
  const work = created.data;
  check('POST /api/works（带选题）', created.status === 200 && !!work?.id, `id=${work?.id}`);
  check('从选题继承题材与平台', work?.genre === '都市' && work?.targetPlatform === 'fanqie');
  check('从选题继承目标与日更', work?.targetWords === 1500000 && work?.dailyGoal === 6000);
  check('作品回挂选题', work?.topicId === topic.id);
  /* 开书前准备迁移：人物小传 + 详纲进设定库 */
  const st = (await j(`/api/works/${work.id}/settings`)).data?.settings;
  check(
    '人物小传自动进设定库（含性别 / 现实原型 / 真实欲望 / 习惯动作）',
    st?.characters?.length === 2 &&
      st.characters[0].role === '主角' &&
      st.characters[0].gender === '男' &&
      st.characters[1].gender === '女' &&
      st.characters[0].background.includes('现实原型') &&
      st.characters[0].note.includes('真实欲望') &&
      st.characters[0].catchphrase.includes('转戒指'),
    `人物=${st?.characters?.length}`
  );
  const olTitles = (st?.outline || []).map((o) => o.title);
  check(
    '详纲各段独立成大纲节点（主线 / 支线 / 暗线 / 预案 / 卖点）',
    olTitles.includes('详纲·主线') &&
      olTitles.includes('详纲·支线与副本') &&
      olTitles.includes('详纲·隐藏线（暗线）') &&
      olTitles.includes('详纲·备选预案') &&
      olTitles.includes('详纲·故事卖点'),
    `节点=${olTitles.length}`
  );
  check(
    '结局节点带类型标记',
    (st?.outline || []).find((o) => o.title === '详纲·结局设定')?.content.includes('大团圆')
  );
  const adopted = (await j(`/api/topics/${topic.id}`)).data;
  check('选题状态转为已开书', adopted?.status === 'adopted' && adopted?.workId === work.id);
  check('自动创建第一卷', work?.volumes?.[0]?.title === '第一卷');
  const ch = work?.volumes?.[0]?.chapters?.[0];
  check('自动创建第一章', ch?.title === '第一章', `id=${ch?.id}`);

  /* ---- 书名防重名校验 ---- */
  const dup = await j('/api/title/check', { method: 'POST', body: JSON.stringify({ title: '冒烟测试作品' }) });
  check('书名查重：完全相同判为重名', dup.status === 200 && dup.data?.duplicate?.title === '冒烟测试作品');
  const dup2 = await j('/api/title/check', { method: 'POST', body: JSON.stringify({ title: ' 冒烟·测试作品 ' }) });
  check('书名查重：忽略空白与标点', dup2.data?.duplicate?.title === '冒烟测试作品');
  const sim = await j('/api/title/check', { method: 'POST', body: JSON.stringify({ title: '冒烟测试作品传' }) });
  check('书名查重：近似判为相似（不拦截）', !sim.data?.duplicate && (sim.data?.similar?.length || 0) >= 1, `similar=${sim.data?.similar?.[0]?.score}%`);
  const clean = await j('/api/title/check', { method: 'POST', body: JSON.stringify({ title: '都市医仙传' }) });
  check('书名查重：无关书名不误报', !clean.data?.duplicate && !clean.data?.similar?.length);

  const text = '林渊睁开眼，四周是刺骨的寒意。\n他记得自己最后看到的，是一道劈开夜色的剑光。';
  const saved = await j(`/api/works/${work.id}/chapters/${ch.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: '第一章 剑光', contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, text, snapshot: true }),
  });
  check('PUT 章节保存', saved.status === 200 && saved.data?.ok, `字数=${saved.data?.wordCount}`);
  check('中文字数统计正确', saved.data?.wordCount === text.replace(/\s/g, '').length);

  const got = await j(`/api/works/${work.id}/chapters/${ch.id}`);
  check('GET 章节回读', got.data?.text === text);

  const snaps = await j(`/api/works/${work.id}/chapters/${ch.id}/snapshots`);
  check('快照已生成', (snaps.data?.snapshots?.length || 0) >= 1, `共 ${snaps.data?.snapshots?.length} 个`);

  const added = await j(`/api/works/${work.id}/volumes/${work.volumes[0].id}/chapters`, {
    method: 'POST',
    body: JSON.stringify({ title: '第二章' }),
  });
  check('新增章节', added.status === 200 && added.data?.title === '第二章');

  const exp = await fetch(`${BASE}/api/works/${work.id}/export.txt`);
  const body = await exp.text();
  check('导出 txt', exp.status === 200 && body.includes('林渊睁开眼'), `${body.length} 字节`);

  const git = await j('/api/git/status');
  check('Git 版本镜像可用', git.data?.available === true);

  // 落盘确认（断电保护的关键：文件真的在磁盘上）
  const file = await readFile(path.join(TMP_DATA, 'works', work.id, 'chapters', `${ch.id}.md`), 'utf8');
  check('正文已落盘为 .md（Git 镜像）', file.includes('林渊睁开眼'));
  const jsonFile = JSON.parse(await readFile(path.join(TMP_DATA, 'works', work.id, 'chapters', `${ch.id}.json`), 'utf8'));
  check('正文已落盘为 .json', jsonFile.text === text);

  /* ---- 设定库（W2）：人物 / 世界观 / 大纲 ---- */
  const sPut = await j(`/api/works/${work.id}/settings`, {
    method: 'PUT',
    body: JSON.stringify({
      characters: [{ id: 'c1', name: '林渊', role: '主角', personality: '冷静果断' }],
      world: [{ id: 'w1', category: '力量体系', title: '灵气', content: '天地间可吸收的能量' }],
      outline: [
        { id: 'o1', type: 'volume', title: '第一卷 觉醒', parentId: null, content: '', targetWords: 200000, linkedChapterId: null, order: 0 },
        { id: 'o2', type: 'chapter', title: '第一章 剑光', parentId: 'o1', content: '开篇遇袭', targetWords: 3000, linkedChapterId: ch.id, order: 0 },
      ],
    }),
  });
  check('PUT 设定库', sPut.status === 200 && sPut.data?.characters?.length === 1, `角色=${sPut.data?.characters?.length}`);

  const sGet = await j(`/api/works/${work.id}/settings`);
  check('GET 设定库', sGet.data?.settings?.world?.[0]?.title === '灵气' && sGet.data?.settings?.outline?.length === 2);

  const ctx = await j(`/api/works/${work.id}/settings/context`);
  check(
    '设定上下文可序列化（含人物与大纲，W3 用）',
    ctx.data?.context?.includes('林渊') && ctx.data?.context?.includes('第一卷 觉醒'),
    `${ctx.data?.context?.length} 字`,
  );

  /* ---- W3：AI 配置 / 续写 / 投稿前自检 ---- */
  const aiCfg = await j('/api/ai/config');
  check('AI 配置接口（未配置时 configured=false）', aiCfg.status === 200 && aiCfg.data?.configured === false, `model=${aiCfg.data?.model}`);

  const setCfg = await j('/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify({ baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-test-1234567890' }),
  });
  check('PUT AI 配置保存', setCfg.status === 200 && setCfg.data?.configured === true && setCfg.data?.source === 'file', `mask=${setCfg.data?.keyMask}`);
  check(
    'GET AI 配置返回掩码（不泄露明文）',
    setCfg.data?.keyMask === 'sk-****7890' && !JSON.stringify(setCfg.data).includes('sk-test-1234567890'),
  );

  const reCfg = await j('/api/ai/config');
  check('AI 配置持久化', reCfg.data?.base === 'https://api.deepseek.com/v1' && reCfg.data?.model === 'deepseek-chat');

  const keepKey = await j('/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify({ baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
  });
  check('改 base/model 时留空 Key 会保留原 Key', keepKey.data?.configured === true && keepKey.data?.keyMask === 'sk-****7890');

  const cleared = await j('/api/ai/config', { method: 'PUT', body: JSON.stringify({ clearKey: true }) });
  check('可清除 Key（回退 .env）', cleared.data?.configured === false && cleared.data?.keyMask === null);

  /* ---- 多模型支持：新增 / 切换 / 删除 ---- */
  const add1 = await j('/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify({ op: 'add', provider: { name: '本地 Ollama', baseURL: 'http://localhost:11434/v1', model: 'qwen3.5:4b' } }),
  });
  check(
    '多模型：新增第二条（不影响当前生效）',
    add1.data?.providers?.length === 2 && add1.data?.activeId === 'p1' && add1.data.providers.some((p) => p.name === '本地 Ollama'),
    `providers=${add1.data?.providers?.length} activeId=${add1.data?.activeId}`
  );

  const add2 = await j('/api/ai/config', {
    method: 'PUT',
    body: JSON.stringify({
      op: 'add',
      provider: { name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'sk-ds-000011112222' },
    }),
  });
  const ds = add2.data?.providers?.find((p) => p.name === 'DeepSeek');
  check('多模型：新增第三条并回带掩码', !!ds && ds.hasKey === true && !!ds.keyMask, `ds=${ds?.id} mask=${ds?.keyMask}`);

  const act = await j('/api/ai/config', { method: 'PUT', body: JSON.stringify({ op: 'activate', id: ds.id }) });
  check(
    '多模型：切换生效模型（网关/模型/Key 跟着变）',
    act.data?.activeId === ds.id && act.data?.model === 'deepseek-chat' && act.data?.base === 'https://api.deepseek.com/v1' && act.data?.configured === true,
    `activeId=${act.data?.activeId} model=${act.data?.model} configured=${act.data?.configured}`
  );

  const del = await j('/api/ai/config', { method: 'PUT', body: JSON.stringify({ op: 'delete', id: ds.id }) });
  check(
    '多模型：删掉生效中那条 → 自动回退到其它模型',
    del.data?.providers?.length === 2 && del.data?.activeId && del.data.activeId !== ds.id,
    `providers=${del.data?.providers?.length} activeId=${del.data?.activeId}`
  );

  /* ---- 封面图片模型配置（多模态） ---- */
  const img0 = await j('/api/ai/image-config');
  check('图片模型配置接口可读', img0 && typeof img0.data?.enabled === 'boolean', `enabled=${img0.data?.enabled}`);
  const imgSave = await j('/api/ai/image-config', {
    method: 'POST',
    body: JSON.stringify({ enabled: true, baseURL: 'https://img.example.com/v1', model: 'gpt-image-1', apiKey: 'sk-imagetest123456' }),
  });
  check('可保存图片模型配置', imgSave.data?.enabled === true && imgSave.data?.model === 'gpt-image-1' && imgSave.data?.keyMask === 'sk-****3456', `base=${imgSave.data?.base} model=${imgSave.data?.model}`);
  const imgClear = await j('/api/ai/image-config', { method: 'POST', body: JSON.stringify({ clearKey: true }) });
  check('可清除图片模型 Key', imgClear.data?.hasKey === false && imgClear.data?.keyMask === null, `hasKey=${imgClear.data?.hasKey}`);
  await j('/api/ai/image-config', { method: 'POST', body: JSON.stringify({ enabled: false, baseURL: '', model: '', apiKey: '' }) });

  /* ---- W4：AI 选题生成（桩 fetch，不依赖真实 AI） ---- */
  try {
    const { generateTopic, generateChars } = await import('../server/ai.js');
    const fakeJson = JSON.stringify({
      title: '签到之王',
      logline: '废柴少年每天签到都能拿到神级物品，靠白手起家逆袭全网',
      protagonist: '一个被全网嘲讽的废物',
      hook: '开局被当众羞辱，签到系统却送出第一件神物，全场打脸',
      channel: 'male',
      genre: '都市',
      platform: 'fanqie',
      tags: ['签到', '系统流', '逆袭', '神豪'],
      audience: '18-30 岁男性爽文读者',
      refWorks: [{ name: '某某签到文', why: '抄爽点密度，避开注水' }],
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n' + fakeJson + '\n```' } }] }),
    });
    const g = await generateTopic({ seed: '签到逆袭', channel: 'male', platform: 'fanqie', mode: 'new' });
    check('AI 选题生成：解析+清洗枚举', g && g.genre === '都市' && g.platform === 'fanqie' && g.tags.includes('签到') && g.refWorks.length >= 1, `genre=${g?.genre} tags=${g?.tags?.length}`);

    const f = await generateTopic({
      mode: 'fill',
      current: { title: '我的选题', logline: '', protagonist: '', hook: '', channel: 'female', genre: '种田', platform: 'jinjiang', tags: [], audience: '', refWorks: [] },
    });
    check('AI 选题补全：保留作者已定的频道/平台/题材', f && f.channel === 'female' && f.platform === 'jinjiang' && f.genre === '种田' && !!f.logline, `channel=${f?.channel} logline?=${!!f?.logline}`);
    globalThis.fetch = origFetch;

    // 人物起草：已存在的名字 + 批次内重名都要被跳过
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                chars: [
                  { name: '林渊', gender: '男' },
                  { name: '林渊', gender: '男' },
                  { name: '苏晚', gender: '女', camp: '中性' },
                ],
              }),
            },
          },
        ],
      }),
    });
    const cs = await generateChars({ logline: '测试' }, ['林渊']);
    check(
      '人物起草去重：跳过已存在与批次内重名，且带性别',
      cs.length === 1 && cs[0].name === '苏晚' && cs[0].gender === '女',
      `剩余=${cs.map((c) => c.name).join(',')}`
    );
    globalThis.fetch = origFetch;

    // 详纲：模型偶发把 branches/stages 返回成对象数组，必须转成可读文本而非 [object Object]
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                background: '现代都市，灵气复苏',
                theme: '平凡人逆袭',
                mainline: '主角靠系统一路升级',
                branches: [
                  { name: '副本A', provides: '为名提供资源' },
                  { name: '副本B', provides: '为名提供情报' },
                ],
                hidden: '暗线真相',
                stages: [
                  { phase: '开局', conflict: '立足' },
                  { phase: '高潮', conflict: '决战' },
                ],
                timeline: '一年跨度',
                ending: '大结局收束',
                endingType: '大团圆',
                backup: '写偏预案',
                selling: '爽点差异',
              }),
            },
          },
        ],
      }),
    });
    const { generateOutline } = await import('../server/ai.js');
    const ol = await generateOutline({ logline: '测试', channel: 'male', genre: '都市' });
    const ok = ol && !String(ol.branches).includes('[object Object]') && ol.branches.includes('副本A') && ol.branches.includes('提供资源') && !String(ol.stages).includes('[object Object]') && ol.stages.includes('开局') && ol.stages.includes('决战');
    check('详纲对象数组字段转可读文本（非 [object Object]）', ok, `branches=${ol?.branches} | stages=${ol?.stages}`);
    globalThis.fetch = origFetch;

    // 开头技法自检（纯函数，不依赖 AI）
    const { checkOpening } = await import('../src/lib/openingCheck.js');
    const empty = checkOpening({});
    check(
      '开头自检：全空 → 4 项 fail + 风险高',
      empty.fail === 4 && empty.verdict.level === 'risk',
      `fail=${empty.fail} level=${empty.verdict.level}`
    );
    const partial = checkOpening({ hook: '平平无奇地开始', detailOutline: { hidden: '身世之谜' } });
    check(
      '开头自检：钩子无反常信号 → warn；缺主线/人物 → fail',
      partial.items.find((i) => i.key === 'hook')?.status === 'warn' &&
        partial.items.find((i) => i.key === 'mainline')?.status === 'fail' &&
        partial.items.find((i) => i.key === 'chars')?.status === 'fail',
      `verdict=${partial.verdict.level}`
    );
    const good = checkOpening({
      hook: '这么不吓人的鬼屋我还是第一次见',
      detailOutline: { hidden: '父母离奇失踪', mainline: '鬼屋入不敷出交不起租' },
      topicChars: [{ name: '陈歌', personality: '隐忍记仇', arc: '从社恐到独当一面' }],
    });
    check(
      '开头自检：四要素齐备 → 全 pass + 可以开',
      good.fail === 0 && good.warn === 0 && good.verdict.level === 'great',
      `fail=${good.fail} warn=${good.warn} level=${good.verdict.level}`
    );
    // 黄金三章：按题材选模板 + 逐章生成 + 结构解析
    const { generateFirstChapters, pickOpeningTemplate } = await import('../server/ai.js');
    check(
      '开头模板：按题材挑选',
      pickOpeningTemplate({ genre: '都市' }) === 'urban' &&
        pickOpeningTemplate({ genre: '玄幻' }) === 'xuanhuan' &&
        pickOpeningTemplate({ genre: '灵异' }) === 'lingyi' &&
        pickOpeningTemplate({ tags: ['穿越'] }) === 'chuanyue',
      `都市=${pickOpeningTemplate({ genre: '都市' })} 玄幻=${pickOpeningTemplate({ genre: '玄幻' })}`
    );

    let n = 0;
    globalThis.fetch = async () => {
      n += 1;
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  title: `第${n}章 测试`,
                  text: '这么不吓人的鬼屋我还是第一次见。\n\n正文内容。',
                  hook: '章末留了个悬念',
                }),
              },
            },
          ],
        }),
      };
    };
    const fc = await generateFirstChapters({ genre: '灵异', logline: '测试' }, { count: 3 });
    check(
      '黄金三章：生成 3 章且带模板与技法',
      fc.chapters.length === 3 && !!fc.template && fc.techniques.length >= 5 && fc.chapters[0].hook === '章末留了个悬念',
      `章数=${fc.chapters.length} 模板=${fc.template} 技法=${fc.techniques.length}`
    );
    globalThis.fetch = origFetch;

    // 续写下一章
    const { generateNextChapter } = await import('../server/ai.js');
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ title: '第二章 追踪', text: '承接上章的正文内容。', hook: '章末钩子' }),
            },
          },
        ],
      }),
    });
    const nx = await generateNextChapter({ prevTail: '上一章结尾…', settingContext: '主角：陈歌' });
    check(
      '续写下一章：返回标题/正文/钩子',
      nx.title === '第二章 追踪' && nx.text.includes('承接上章') && nx.hook === '章末钩子',
      `title=${nx.title}`
    );
    globalThis.fetch = origFetch;

    // 稿件审阅（正常 + 降级）
    const { reviewText } = await import('../server/ai.js');
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scores: { hook: 4, pacing: 3, character: 5, dialogue: 2, conflict: 9, style: 'x' },
                summary: '整体能看，对话偏弱。',
                good: ['开头钩子立得住'],
                issues: [
                  { level: 'high', point: '第二章对话全是汇报', suggestion: '改成带情绪的争执' },
                  { level: 'low', point: '有个错字', suggestion: '改掉' },
                ],
              }),
            },
          },
        ],
      }),
    });
    const rv = await reviewText({ text: '正文…'.repeat(50), chapterTitle: '第一章', isOpening: true });
    check(
      '审阅：越界/非法分数被清洗，问题分级保留',
      rv.scores.conflict === 0 && rv.scores.style === 0 && rv.scores.hook === 4 && rv.issues.length === 2 && rv.issues[0].level === 'high',
      `conflict=${rv.scores.conflict} style=${rv.scores.style} issues=${rv.issues.length}`
    );

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '这不是 JSON，是一段意见' } }] }) });
    const rv2 = await reviewText({ text: '正文…' });
    check(
      '审阅：模型返回非法 JSON 时降级为纯文本意见',
      rv2.scores === null && String(rv2.summary).includes('这不是 JSON') && Array.isArray(rv2.issues),
      `summary=${String(rv2.summary).slice(0, 12)}`
    );
    globalThis.fetch = origFetch;
  } catch (e) {
    check('AI 选题生成单元测试', false, e.message);
  }

  // 给第二章写入含敏感词/违规词的文本，验证自检能识别
  const ch2 = added.data;
  const text2 = '他掏出手机说：加微信详聊，代写也接。\n夜色渐深，街角的灯一盏盏亮起。';
  const saved2 = await j(`/api/works/${work.id}/chapters/${ch2.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: '第二章', contentJson: { type: 'doc', content: [{ type: 'paragraph' }] }, text: text2 }),
  });
  check('PUT 第二章（含违规词样本）', saved2.status === 200 && saved2.data?.wordCount === text2.replace(/\s/g, '').length);

  const sc = await j(`/api/works/${work.id}/selfcheck`);
  check('自检接口返回结构', sc.status === 200 && Array.isArray(sc.data?.chapters) && typeof sc.data?.totalAiRatio === 'number');
  check('自检识别敏感词/违规词（加微信·代写）', (sc.data?.sensitive?.length || 0) >= 1, `命中章节=${sc.data?.sensitive?.length}`);
  check('自检给出全书总字数', typeof sc.data?.totalWords === 'number' && sc.data.totalWords > 0, `${sc.data.totalWords} 字`);

  await j(`/api/works/${work.id}`, { method: 'DELETE' });
  const after = await j('/api/works');
  check('删除作品', !after.data.works.some((w) => w.id === work.id));
} catch (e) {
  console.error('\n冒烟测试异常：', e);
  failed += 1;
} finally {
  child.kill();
  await rm(TMP_DATA, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? `✗ ${failed} 项失败` : '✓ 全部通过'}\n`);
process.exit(failed ? 1 : 0);
