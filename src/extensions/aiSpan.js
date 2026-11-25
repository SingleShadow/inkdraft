import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * aiSpan：标记「来自 AI 起草、且作者已改写」的正文片段。
 * 设计要点（对应 v0.5 三条硬护栏）：
 *  - 标记不可擦除：读者/作者能永久看到哪段是 AI 起草的（除非主动清除）
 *  - raw 保存 AI 原文，用于计算改写率与自检举证
 *  - ratio / rewritten 记录作者改写程度
 * 这只是本地元数据标记，不构成「AI 率」对外展示。
 */
export const AiSpan = Mark.create({
  name: 'aiSpan',
  inclusive: false,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-raw') || '',
        renderHTML: (attrs) => (attrs.raw ? { 'data-raw': attrs.raw } : {}),
      },
      ratio: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-ratio')) || 0,
        renderHTML: (attrs) => ({ 'data-ratio': attrs.ratio || 0 }),
      },
      rewritten: {
        default: false,
        parseHTML: (el) => el.getAttribute('data-rewritten') === '1',
        renderHTML: (attrs) => ({ 'data-rewritten': attrs.rewritten ? '1' : '0' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-ai-span]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ai-span': '1' }), 0];
  },
});
