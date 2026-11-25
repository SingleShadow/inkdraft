// 开头技法自检（纯函数，可在前端与 Node 单测中复用）
//
// 理论来源：知乎「黑门山」拆《我有一座冒险屋》第一章的四套开头技巧 ——
//   1) 香农信息论：开篇第一句用「小概率/反常识事件」制造信息量，勾住好奇心；
//   2) 搞笑三核心：用一个反差/段子让人物可爱，读者产生好感、变粉丝；
//   3) 马斯洛需求：给主角制造「远忧 + 近虑」的需求缺口，焦虑即追读动力；
//   4) 内啡肽原理：以上一切最终落在一个「愉悦/爽感」闭环里。
//
// 这里对选题当前填的字段做启发式检查，给出 pass / warn / fail 与补全建议，
// 不依赖 AI，纯本地规则，秒出。

// 「反常 / 小概率」信号词：命中即视为开篇有钩子感
const REBEL_WORDS = [
  '第一次', '首次', '头一回', '居然', '竟然', '竟敢', '没想到', '想不到',
  '偏偏', '从未', '从没', '罕见', '反常', '诡异', '离奇', '不料', '万万',
  '活久见', '压根', '本该', '本以为', '竟', '竟有', '竟是',
];

export function hasRebelSignal(text = '') {
  return REBEL_WORDS.some((w) => text.includes(w));
}

export function checkOpening(topic = {}) {
  const hook = String(topic.hook || '').trim();
  const hidden = String(topic.detailOutline?.hidden || '').trim();
  const mainline = String(topic.detailOutline?.mainline || '').trim();
  const chars = Array.isArray(topic.topicChars) ? topic.topicChars : [];
  const namedChars = chars.filter((c) => String(c?.name || '').trim());
  const memorable = namedChars.some((c) =>
    [c.personality, c.arc, c.cause, c.habit, c.flaw].some((v) => String(v || '').trim())
  );

  const items = [];

  // 1. 开篇反常（香农信息论）
  if (!hook) {
    items.push({
      key: 'hook',
      label: '开篇第一句反常（香农信息论）',
      status: 'fail',
      tip: '还没填「黄金三章钩子」。好开头第一句就要抛一个小概率 / 反常识事件，例如「这么不吓人的鬼屋我还是第一次见」。',
    });
  } else if (hook.length < 15) {
    items.push({
      key: 'hook',
      label: '开篇第一句反常（香农信息论）',
      status: 'warn',
      tip: '钩子偏短（<15 字），第一句的反常感立不住，建议扩写，把「反常 / 小概率」写具体。',
    });
  } else if (!hasRebelSignal(hook)) {
    items.push({
      key: 'hook',
      label: '开篇第一句反常（香农信息论）',
      status: 'warn',
      tip: '没检测到「反常 / 小概率」信号词（第一次 / 居然 / 竟然 / 没想到…）。开头第一句建议加入反常识事件，信息量越大越勾人。',
    });
  } else {
    items.push({
      key: 'hook',
      label: '开篇第一句反常（香农信息论）',
      status: 'pass',
      tip: '钩子带反常信号，开篇能靠「小概率事件」勾住好奇心。',
    });
  }

  // 2. 主角远忧（马斯洛·安全需求·远忧）
  if (!hidden) {
    items.push({
      key: 'hidden',
      label: '主角远忧 · 暗线（马斯洛）',
      status: 'fail',
      tip: '缺暗线 / 远忧（身世谜团、大危机等长期悬念）。读者缺少长期追读锚点，容易在中后段流失。',
    });
  } else {
    items.push({
      key: 'hidden',
      label: '主角远忧 · 暗线（马斯洛）',
      status: 'pass',
      tip: '已埋暗线 / 远忧，长期追读锚点有了。',
    });
  }

  // 3. 主角近虑（马斯洛·近虑）
  if (!mainline) {
    items.push({
      key: 'mainline',
      label: '主角近虑 · 主线（马斯洛）',
      status: 'fail',
      tip: '缺主线 / 近虑（眼下迫切矛盾，如活不下去、被逼到绝境）。前几章缺紧迫感容易平淡。',
    });
  } else {
    items.push({
      key: 'mainline',
      label: '主角近虑 · 主线（马斯洛）',
      status: 'pass',
      tip: '已写主线 / 近虑，前几章有紧迫矛盾撑着。',
    });
  }

  // 4. 人物记忆点（搞笑三核心·人物好感）
  if (!namedChars.length) {
    items.push({
      key: 'chars',
      label: '人物记忆点（搞笑三核心 · 好感）',
      status: 'fail',
      tip: '还没写人物小传，读者没有记忆点。建议先用「人物小传 · AI 起草」生成主角。',
    });
  } else if (!memorable) {
    items.push({
      key: 'chars',
      label: '人物记忆点（搞笑三核心 · 好感）',
      status: 'warn',
      tip: '人物有了，但都没填性格 / 弧光 / 口头禅 / 缺陷。给主角至少一个记忆点，读者才会产生好感、变成粉丝。',
    });
  } else {
    items.push({
      key: 'chars',
      label: '人物记忆点（搞笑三核心 · 好感）',
      status: 'pass',
      tip: '主角已有性格 / 弧光等记忆点，人物好感基础有了。',
    });
  }

  // 5. 三件套齐备（情绪闭环）
  const core = [hook, hidden, mainline].every(Boolean);
  if (core) {
    items.push({
      key: 'core',
      label: '钩子 + 暗线 + 主线 三件套齐备',
      status: 'pass',
      tip: '前 1–3 章的 钩子 / 暗线 / 主线 都已埋下，追读动力闭环成立。',
    });
  } else {
    items.push({
      key: 'core',
      label: '钩子 + 暗线 + 主线 三件套齐备',
      status: 'warn',
      tip: '钩子 / 暗线 / 主线 还缺项，前 1–3 章的追读闭环没完全立住，先补齐上面标 ✗ 的项。',
    });
  }

  const fail = items.filter((i) => i.status === 'fail').length;
  const warn = items.filter((i) => i.status === 'warn').length;
  let verdict;
  if (fail) {
    verdict = { level: 'risk', label: '风险高', text: '有硬缺口，建议先补完标 ✗ 的项再开书，否则前几章容易扑。' };
  } else if (warn) {
    verdict = { level: 'ok', label: '勉强够', text: '主干齐了，把标 ! 的几项补一补，开头会更稳。' };
  } else {
    verdict = { level: 'great', label: '可以开', text: '开头四要素都在，按这个去写前三章，追读动力闭环成立。' };
  }

  return { items, verdict, fail, warn };
}
