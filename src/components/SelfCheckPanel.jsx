import React from 'react';
import { api } from '../api.js';
import { platformThreshold } from '../lib/aiSpans.js';

/**
 * 投稿前自检报告：总字数、AI 占比（平台阈值色）、敏感词、格式灌水、各章明细。
 * 工具型定位下，这里只做「自查提示」，不拦截、不替代平台审核。
 */
export default function SelfCheckPanel({ work, onClose }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      try {
        const r = await api.selfcheck(work.id);
        setData(r);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [work.id]);

  const th = platformThreshold(work.targetPlatform);
  const aiColor = (ratio) => (ratio <= th.green ? 'ok' : ratio <= th.yellow ? 'warn' : 'danger');

  const hitCount = data ? data.sensitive.reduce((n, s) => n + s.hits.length, 0) : 0;
  const fmtCount = data ? data.format.reduce((n, s) => n + s.issues.length, 0) : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>投稿前自检报告</b>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="hint">统计中…</p>}
          {error && <p className="err">{error}</p>}

          {data && (
            <>
              <div className="sc-summary">
                <div className="sc-stat">
                  <span>全书字数</span>
                  <b>{data.totalWords.toLocaleString()}</b>
                </div>
                <div className="sc-stat">
                  <span>AI 占比</span>
                  <b className={aiColor(data.totalAiRatio)}>
                    {Math.round(data.totalAiRatio * 100)}%
                  </b>
                </div>
                <div className="sc-stat">
                  <span>敏感词命中</span>
                  <b className={hitCount ? 'danger' : 'ok'}>{hitCount}</b>
                </div>
                <div className="sc-stat">
                  <span>格式问题</span>
                  <b className={fmtCount ? 'warn' : 'ok'}>{fmtCount}</b>
                </div>
              </div>
              <p className="hint sc-note">
                合格线（{th.label}）：AI 占比 ≤{Math.round(th.green * 100)}% 绿 / ≤
                {Math.round(th.yellow * 100)}% 黄 / 以上红。本工具只提示，不替代平台审核。
              </p>

              {data.sensitive.length > 0 && (
                <div className="sc-sec">
                  <h4>敏感词 / 违规词命中</h4>
                  {data.sensitive.map((s, i) => (
                    <div key={i} className="sc-row">
                      <span className="sc-ch">{s.chapter}</span>
                      <span className="sc-hits">
                        {s.hits.map((h) => `「${h.word}」`).join('、')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {data.format.length > 0 && (
                <div className="sc-sec">
                  <h4>格式灌水</h4>
                  {data.format.map((s, i) => (
                    <div key={i} className="sc-row">
                      <span className="sc-ch">{s.chapter}</span>
                      <span className="sc-hits">
                        {s.issues
                          .map((iss) => `${iss.type === 'repeat' ? '重复字' : '重复标点'}「${iss.sample}」`)
                          .join('；')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="sc-sec">
                <h4>各章明细</h4>
                <table className="sc-table">
                  <thead>
                    <tr>
                      <th>章节</th>
                      <th>字数</th>
                      <th>AI 占比</th>
                      <th>敏感词</th>
                      <th>格式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.chapters.map((c) => (
                      <tr key={c.id}>
                        <td>{c.title}</td>
                        <td>{c.wordCount}</td>
                        <td className={aiColor(c.aiRatio)}>{Math.round(c.aiRatio * 100)}%</td>
                        <td className={c.sensitive ? 'danger' : 'ok'}>{c.sensitive || '-'}</td>
                        <td className={c.format ? 'warn' : 'ok'}>{c.format || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
