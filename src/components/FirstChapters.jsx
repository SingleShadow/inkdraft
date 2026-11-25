import React from 'react';
import { api } from '../api.js';

/** 纯文本 → Tiptap 文档结构（按空行分段） */
function textToDoc(text) {
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

/**
 * AI 写前几章（黄金三章）。
 * 技法来自知乎「如何写好网络小说开头」多个高赞回答：
 * 黑门山的四理论（香农反常钩子 / 搞笑三核心 / 马斯洛困境 / 内啡肽闭环）、
 * 花爷的分题材开头模板、以及新人避雷（别堆人名、主角突出、别堆设定、别炫技）。
 */
export default function FirstChapters({ work, topic, onClose, onWritten }) {
  const [count, setCount] = React.useState(3);
  const [busy, setBusy] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [res, setRes] = React.useState(null);
  const [writing, setWriting] = React.useState(false);
  const timer = React.useRef(null);

  React.useEffect(() => () => clearInterval(timer.current), []);

  function startTimer() {
    setElapsed(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }

  async function gen() {
    setBusy(true);
    setErr('');
    setMsg('');
    setRes(null);
    startTimer();
    try {
      const r = await api.aiFirstChapters({
        topic: {
          title: work?.title || topic?.title || '',
          logline: topic?.logline || '',
          protagonist: topic?.protagonist || '',
          hook: topic?.hook || '',
          channel: topic?.channel || '',
          genre: topic?.genre || work?.genre || '',
          tags: topic?.tags || [],
          detailOutline: topic?.detailOutline || null,
          topicChars: topic?.topicChars || [],
        },
        count,
      });
      setRes(r);
      if (!r?.chapters?.length) setErr('没有生成内容，再试一次');
    } catch (e) {
      setErr(e.message || '生成失败');
    } finally {
      clearInterval(timer.current);
      setBusy(false);
    }
  }

  function patchChapter(i, field, value) {
    setRes((r) => {
      if (!r) return r;
      const chapters = r.chapters.map((c, k) => (k === i ? { ...c, [field]: value } : c));
      return { ...r, chapters };
    });
  }

  async function writeIn() {
    if (!res?.chapters?.length || !work) return;
    setWriting(true);
    setErr('');
    setMsg('');
    try {
      const volId = work.volumes?.[0]?.id;
      if (!volId) throw new Error('这个作品还没有分卷，先在左边加一卷');
      const ids = [];
      for (const ch of res.chapters) {
        const c = await api.addChapter(work.id, volId, ch.title);
        await api.saveChapter(work.id, c.id, {
          title: ch.title,
          contentJson: textToDoc(ch.text),
          text: ch.text,
        });
        ids.push(c.id);
      }
      setMsg(`已写入 ${ids.length} 章`);
      onWritten?.(ids);
    } catch (e) {
      setErr(e.message || '写入失败');
    } finally {
      setWriting(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>AI 写前几章（黄金三章）</b>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            按知乎多位作者总结的开头技法逐章生成：开头反常钩子、困境焦虑、反差段子、章末钩子，并按题材套用对应的开头范式。
            生成后可以直接改，满意了再写进作品。
          </p>

          <details className="craft-tip">
            <summary>写作锦囊：怎么把脑海里的故事写出来？</summary>
            <ul>
              <li><b>场景万能公式</b>：时间 + 地点 + 天气 + 环境 + 路人，先把空间立住，再让主角出场。</li>
              <li><b>镜头感</b>：让路人 / 环境先动，再把镜头摇到主角身上，避免硬切；上一幕的细节下一幕要承接。</li>
              <li><b>出场次序</b>：外貌 + 动作 → 说话 → 对方带动作 / 神态 / 语言回应，对话不要是干巴巴的引号。</li>
              <li><b>「衬」人物</b>：性格靠反差与细节衬托（如用话痨配角反衬主角沉默），别直接写「他很沉默」。人物塑造来自「花开岁寒」的回答。</li>
              <li><b>起承转合</b>：每段都要有目标、冲突、驱动力、逻辑闭环，禁止平铺直叙无波无澜。</li>
            </ul>
          </details>

          <div className="fc-bar">
            <label>
              生成章数
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
                <option value={1}>1 章</option>
                <option value={2}>2 章</option>
                <option value={3}>3 章（黄金三章）</option>
              </select>
            </label>
            <button className="btn primary" disabled={busy || writing} onClick={gen}>
              {busy ? `生成中… ${elapsed}s` : '开始生成'}
            </button>
            {res && (
              <button className="btn" disabled={busy || writing} onClick={gen}>
                重新生成
              </button>
            )}
          </div>

          {busy && <p className="hint">本地小模型一次生成 {count} 章可能需要 1–3 分钟，别关窗口。</p>}

          {res?.template && (
            <div className="fc-tech">
              <div className="fc-tech-head">
                <b>本次采用的开头范式：</b>
                <span>{res.template}</span>
              </div>
              <ul>
                {(res.techniques || []).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {err && <p className="err">{err}</p>}
          {msg && <p className="ai-state ok">{msg}</p>}

          {!!res?.chapters?.length && (
            <div className="fc-list">
              {res.chapters.map((c, i) => (
                <div className="fc-ch" key={i}>
                  <div className="fc-ch-head">
                    <span className="fc-ch-no">第 {i + 1} 章</span>
                    <input
                      className="inp"
                      value={c.title}
                      onChange={(e) => patchChapter(i, 'title', e.target.value)}
                      placeholder="章节标题"
                    />
                    <span className="fc-ch-words">{c.text.replace(/\s/g, '').length} 字</span>
                  </div>
                  <textarea
                    className="fc-ch-text"
                    rows={10}
                    value={c.text}
                    onChange={(e) => patchChapter(i, 'text', e.target.value)}
                  />
                  {c.hook && <p className="fc-hook">章末钩子：{c.hook}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="ai-actions">
            {!!res?.chapters?.length && (
              <button className="btn primary" disabled={writing || busy} onClick={writeIn}>
                {writing ? '写入中…' : `写入作品（${res.chapters.length} 章）`}
              </button>
            )}
            <span className="spacer" />
            <button className="link-btn" onClick={onClose}>
              关闭
            </button>
          </div>
          <p className="hint ai-tip">
            写进去的是新章节，不会覆盖你已有的内容；不满意可以在左边删掉重新生成。
          </p>
        </div>
      </div>
    </div>
  );
}
