import React from 'react';
import { api } from '../api.js';

const LEVEL_LABEL = { high: '必须改', mid: '建议改', low: '可优化' };

/**
 * 稿件审阅：编辑视角的内容评审。
 * 和「自检」不同——自检查的是敏感词 / AI 占比 / 格式这类机械项，这里评的是写得好不好。
 */
export default function ReviewPanel({ work, chapterId, onClose }) {
  const [scope, setScope] = React.useState(chapterId ? 'chapter' : 'all');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [r, setR] = React.useState(null);

  async function run() {
    setBusy(true);
    setErr('');
    setR(null);
    try {
      const data = scope === 'chapter' ? { chapterId } : { scope: 'all' };
      const res = await api.aiReview(work.id, data);
      setR(res);
    } catch (e) {
      setErr(e.message || '审阅失败');
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dims = r?.dims || [];
  const scores = r?.scores || null;
  const avg =
    scores && dims.length
      ? (dims.reduce((n, d) => n + (scores[d.key] || 0), 0) / dims.filter((d) => scores[d.key] > 0).length || 0)
      : 0;
  const issues = r?.issues || [];
  const byLevel = (lv) => issues.filter((i) => i.level === lv);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>稿件审阅</b>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            以网文编辑视角评审内容：开头钩子、节奏、人物一致性、对话、冲突爽点、文笔。
            问题会按「必须改 / 建议改 / 可优化」分级，并给出具体改法。
          </p>

          <div className="fc-bar">
            <label>
              审阅范围
              <select value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}>
                {chapterId && <option value="chapter">当前这一章</option>}
                <option value="all">全书</option>
              </select>
            </label>
            <button className="btn primary" disabled={busy} onClick={run}>
              {busy ? '审阅中…' : '开始审阅'}
            </button>
          </div>

          {busy && <p className="hint">本地模型审阅需要 1–2 分钟，别关窗口。</p>}
          {err && <p className="err">{err}</p>}
          {r?.truncated && <p className="note warn">内容超过 6000 字，本次只审了前 6000 字。</p>}

          {r && (
            <>
              {scores ? (
                <div className="rv-scores">
                  {dims.map((d) => {
                    const v = scores[d.key] || 0;
                    return (
                      <div className="rv-row" key={d.key}>
                        <div className="rv-label">
                          <b>{d.label}</b>
                          <span className="hint">{d.hint}</span>
                        </div>
                        <div className="rv-dots">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <i key={n} className={n <= v ? 'on' : ''} />
                          ))}
                          <span className="rv-num">{v || '—'}</span>
                        </div>
                      </div>
                    );
                  })}
                  <div className="rv-avg">综合 {avg ? avg.toFixed(1) : '—'} / 5</div>
                </div>
              ) : (
                <p className="note warn">模型没返回结构化评分，下面是它的原始意见。</p>
              )}

              {r.summary && (
                <div className="rv-summary">
                  <b>总评</b>
                  <p>{r.summary}</p>
                </div>
              )}

              {!!(r.good || []).length && (
                <div className="rv-block">
                  <h4>优点</h4>
                  <ul>
                    {r.good.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!!issues.length && (
                <div className="rv-block">
                  <h4>问题（{issues.length}）</h4>
                  {['high', 'mid', 'low'].map((lv) =>
                    byLevel(lv).length ? (
                      <div className="rv-level" key={lv}>
                        <div className={`rv-level-tag ${lv}`}>{LEVEL_LABEL[lv]}</div>
                        {byLevel(lv).map((it, i) => (
                          <div className="rv-issue" key={i}>
                            <p className="rv-point">{it.point}</p>
                            {it.suggestion && <p className="rv-sug">改法：{it.suggestion}</p>}
                          </div>
                        ))}
                      </div>
                    ) : null
                  )}
                </div>
              )}

              {!issues.length && !busy && <p className="hint">没有提出具体问题。</p>}
            </>
          )}

          <div className="ai-actions">
            <span className="spacer" />
            <button className="link-btn" onClick={onClose}>
              关闭
            </button>
          </div>
          <p className="hint ai-tip">
            审阅给的是参考意见，改不改你自己判断；连续几章都指出同一个问题，才是真的要改。
          </p>
        </div>
      </div>
    </div>
  );
}
