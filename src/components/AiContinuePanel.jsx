import React from 'react';
import { api } from '../api.js';
import { rewriteRatio, platformThreshold } from '../lib/aiSpans.js';

const TONES = [
  ['natural', '自然推进'],
  ['conflict', '冲突升级'],
  ['reversal', '反转打脸'],
  ['emotion', '情感升温'],
  ['suspense', '悬念留白'],
  ['climax', '高潮爆发'],
];
const LENGTHS = [200, 500, 1000];

/**
 * AI 续写入口 + 改写工作台。
 * 设计要点（v0.5）：AI 只给草稿；作者必须在工作台改写达标后才能「干净」插入；
 * 直接插入（未改写）会标红提醒。插入的文本带 aiSpan 标记，计入本章 AI 占比。
 */
export default function AiContinuePanel({ workId, platform, preceding, aiConfigStatus, onOpenSettings, onClose, onInsert }) {
  const [intent, setIntent] = React.useState('');
  const [tone, setTone] = React.useState('natural');
  const [length, setLength] = React.useState(500);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [candidates, setCandidates] = React.useState([]);
  const [active, setActive] = React.useState(-1);
  const [rewriteText, setRewriteText] = React.useState('');

  const th = platformThreshold(platform);
  const ratio = active >= 0 ? rewriteRatio(candidates[active], rewriteText) : 0;
  const pass = ratio >= th.rewrite;

  async function generate() {
    setLoading(true);
    setError('');
    setActive(-1);
    try {
      const r = await api.aiContinue(workId, {
        preceding: (preceding || '').slice(-1600),
        intent,
        tone,
        length,
      });
      setCandidates(r.candidates || []);
      if (!(r.candidates || []).length) setError('AI 返回为空，请调整意图后重试。');
    } catch (e) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>AI 续写 · 草稿需你改写</b>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          {!candidates.length && !loading && (
            <div className="ai-form">
              <p className="hint">
                AI 只给草稿，不能直接发。生成后请在右侧改写台改写 ≥{Math.round(th.rewrite * 100)}% 再插入正文。
              </p>
              <label>续写意图（可选）：你想让这段往哪走？</label>
              <input
                className="inp"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="例如：主角发现线索有诈，决定将计就计"
              />
              <div className="ai-row">
                <div className="ai-row-item">
                  <label>爽点类型</label>
                  <select className="inp" value={tone} onChange={(e) => setTone(e.target.value)}>
                    {TONES.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="ai-row-item">
                  <label>长度</label>
                  <select
                    className="inp"
                    value={length}
                    onChange={(e) => setLength(Number(e.target.value))}
                  >
                    {LENGTHS.map((n) => (
                      <option key={n} value={n}>
                        {n} 字
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button className="btn primary" disabled={loading} onClick={generate}>
                {loading ? '生成中…' : '生成候选'}
              </button>
              {error && <p className="err">{error}</p>}
              {!error && (
                <div className="ai-config-hint">
                  <span>
                    {aiConfigStatus?.configured || aiConfigStatus?.ready
                      ? `AI 已配置（来源：${aiConfigStatus.source === 'file' ? '界面' : '服务器 .env'}${aiConfigStatus.ready && !aiConfigStatus.configured ? ' · 未填 Key' : ''}）`
                      : 'AI 未配置，无法生成候选'}
                  </span>
                  <button className="link-btn" onClick={onOpenSettings}>
                    去设置
                  </button>
                </div>
              )}
            </div>
          )}

          {loading && <p className="hint">AI 正在起草…（首次可能需几秒）</p>}

          {candidates.length > 0 && active < 0 && (
            <div className="ai-cands">
              <div className="ai-cands-head">
                <span>{candidates.length} 个候选方向（任选其一改写）</span>
                <button className="link-btn" onClick={() => setCandidates([])}>
                  重新生成
                </button>
              </div>
              {candidates.map((c, i) => (
                <div key={i} className="ai-card">
                  <div className="ai-card-prev">{c.slice(0, 90)}{c.length > 90 ? '…' : ''}</div>
                  <div className="ai-card-actions">
                    <button
                      className="btn small primary"
                      onClick={() => {
                        setActive(i);
                        setRewriteText(c);
                      }}
                    >
                      改写并插入
                    </button>
                    <button
                      className="link-btn"
                      title="未改写直接插入，将标红提醒"
                      onClick={() => onInsert(c, 0)}
                    >
                      直接插入（未改写）
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {active >= 0 && (
            <div className="rw">
              <div className="rw-head">
                <b>改写工作台</b>
                <button className="link-btn" onClick={() => setActive(-1)}>
                  ← 返回候选
                </button>
              </div>
              <div className="rw-grid">
                <div className="rw-col">
                  <div className="rw-col-h">AI 草稿（只读）</div>
                  <textarea className="rw-ai" value={candidates[active]} readOnly />
                </div>
                <div className="rw-col">
                  <div className="rw-col-h">
                    <span>你的版本</span>
                    <span className={`rw-ratio ${pass ? 'ok' : 'warn'}`}>
                      {Math.round(ratio * 100)}% 已改写
                    </span>
                  </div>
                  <textarea
                    className="rw-mine"
                    value={rewriteText}
                    onChange={(e) => setRewriteText(e.target.value)}
                    placeholder="在这里把 AI 草稿改写成你自己的文字…"
                  />
                </div>
              </div>
              <div className={`rw-bar ${pass ? 'ok' : 'warn'}`}>
                <i style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
                <span className="rw-bar-label">
                  {pass
                    ? `已达 ${Math.round(th.rewrite * 100)}% 改写线，可插入`
                    : `建议改写 ≥${Math.round(th.rewrite * 100)}%（当前 ${Math.round(ratio * 100)}%）`}
                </span>
              </div>
              <div className="rw-actions">
                <button className="btn primary" onClick={() => onInsert(rewriteText, ratio)}>
                  插入正文
                </button>
                <span className="hint">插入后该段将标记 AI 来源，并计入本章 AI 占比。</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
