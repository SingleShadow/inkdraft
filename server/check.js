import { loadSensitive } from './ai.js';

/**
 * 自检逻辑（纯本地、零成本）：敏感词扫描、格式灌水、文风统计、AI 片段提取。
 * 这些能力在「工具型 / 自用」定位下不用于拦截，而是帮作者在投稿前自查风险。
 */

/** 扫描命中：返回 [{category, word, index}] */
export function scanSensitive(text, dict) {
  const d = dict || loadSensitive();
  const hits = [];
  for (const [cat, words] of Object.entries(d)) {
    if (!Array.isArray(words)) continue;
    for (const w of words) {
      if (!w) continue;
      let idx = text.indexOf(w);
      while (idx >= 0) {
        hits.push({ category: cat, word: w, index: idx });
        idx = text.indexOf(w, idx + w.length);
      }
    }
  }
  return hits;
}

/** 文风统计：句长方差、对话占比（用于对照平台检测指标做反向自检） */
export function analyzeStyle(text) {
  const sentences = text
    .split(/[。！？!?\n]/)
    .map((s) => s.replace(/\s/g, ''))
    .filter((s) => s.length > 0);
  const lens = sentences.map((s) => s.length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const variance = lens.length
    ? lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length
    : 0;
  const dialogChars = (text.match(/[“"‘'「『][^”"’'」』]*[”"’'」』]/g) || [])
    .join('')
    .replace(/\s/g, '').length;
  const totalChars = text.replace(/\s/g, '').length;
  return {
    sentenceCount: lens.length,
    meanLen: Math.round(mean),
    variance: Math.round(variance),
    dialogRatio: totalChars ? Number((dialogChars / totalChars).toFixed(2)) : 0,
  };
}

/** 格式灌水检测：连续重复字符（≥5）、连续重复标点（≥4） */
export function detectFormatIssues(text) {
  const issues = [];
  const reps = text.match(/(.)\1{4,}/g) || [];
  for (const r of reps.slice(0, 12)) issues.push({ type: 'repeat', sample: r.slice(0, 14) });
  const punc = text.match(/([。，！？、…—])\1{3,}/g) || [];
  for (const p of punc.slice(0, 6)) issues.push({ type: 'punct', sample: p.slice(0, 8) });
  return issues;
}

/** 从 Tiptap 文档 JSON 中提取带 aiSpan 标记的片段（含 raw/ratio/rewritten） */
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
