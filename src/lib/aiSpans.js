/**
 * 前端 AI 片段提取与改写率计算（与 server/check.js 的 collectAiSpans 对应）。
 */

export function collectAiSpans(doc) {
  const spans = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && Array.isArray(node.marks)) {
      const m = node.marks.find((x) => x && x.type === 'aiSpan');
      if (m) {
        spans.push({
          text: node.text || '',
          raw: (m.attrs && m.attrs.raw) || node.text || '',
          ratio: (m.attrs && Number(m.attrs.ratio)) || 0,
          rewritten: !!(m.attrs && m.attrs.rewritten),
        });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return spans;
}

export function docText(doc) {
  let out = '';
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text') out += n.text || '';
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return out;
}

/** 当前文档的 AI 参与比例 */
export function aiRatioOf(doc) {
  const spans = collectAiSpans(doc);
  const aiChars = spans.reduce((n, s) => n + (s.text || '').replace(/\s/g, '').length, 0);
  const total = docText(doc).replace(/\s/g, '').length;
  return { aiChars, total, ratio: total ? aiChars / total : 0 };
}

/**
 * 改写率：用户版本相对 AI 原版的改动程度（基于 LCS）。
 * 返回 0~1，越大表示改得越多。番茄档要求 ≥0.7 才视为「已实质改写」。
 */
export function rewriteRatio(left, right) {
  const a = left || '';
  const b = right || '';
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return 0;
  if (n === 0 || m === 0) return 1;
  // 限制长度，避免 O(n*m) 过大；续写片段通常几百字，足够
  if (n > 4000 || m > 4000) return b === a ? 0 : 1;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const common = dp[n][m];
  const denom = Math.max(n, m, 1);
  return Math.round((1 - common / denom) * 100) / 100;
}

/**
 * 平台阈值（W3 挂载点，与选题档位一致）。
 *  - green/yellow 是「AI 占比」的合格线（占比越低越好）
 *  - rewrite 是「改写率」的绿灯线（越高越好）
 */
export const PLATFORM_AI_THRESHOLD = {
  fanqie: { label: '番茄小说', green: 0.25, yellow: 0.4, rewrite: 0.7 },
  qidian: { label: '起点中文网', green: 0.15, yellow: 0.3, rewrite: 0.8 },
  jinjiang: { label: '晋江文学城', green: 0.05, yellow: 0.1, rewrite: 0.95 },
  free: { label: '通用 / 其他', green: 0.3, yellow: 0.5, rewrite: 0.6 },
};

export function platformThreshold(platform) {
  return PLATFORM_AI_THRESHOLD[platform] || PLATFORM_AI_THRESHOLD.free;
}
