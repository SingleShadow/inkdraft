import React from 'react';
import { platformLabel } from './Home.jsx';

/** 写作页右侧的选题卡：写偏的时候回来看一眼 */
export default function TopicBrief({ topic, topics = [], onAttach, onOpen, onClose }) {
  const [pick, setPick] = React.useState('');

  if (!topic) {
    // 早期建的作品可能没有选题，这里补一个关联入口
    const candidates = topics.filter((t) => t.status !== 'dropped');
    return (
      <aside className="side">
        <div className="side-head">
          <b>选题</b>
          <button className="icon-btn" onClick={onClose} title="收起">
            ›
          </button>
        </div>
        <div className="side-body">
          <p className="hint">这部作品还没关联选题。补一个，写作时能随时回看当初定的卖点。</p>
          {!!candidates.length && (
            <div className="attach">
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">选一个选题…</option>
                {candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button className="btn btn-block" disabled={!pick} onClick={() => onAttach(pick)}>
                关联到这部作品
              </button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="side">
      <div className="side-head">
        <b>选题 · {topic.title}</b>
        <button className="icon-btn" onClick={onClose} title="收起">
          ›
        </button>
      </div>
      <div className="side-body">
        <div className="brief-block">
          <span className="brief-k">一句话创意</span>
          <p>{topic.logline || '（未填）'}</p>
        </div>
        {!!topic.protagonist && (
          <div className="brief-block">
            <span className="brief-k">主角</span>
            <p>{topic.protagonist}</p>
          </div>
        )}
        {!!topic.hook && (
          <div className="brief-block">
            <span className="brief-k">黄金三章钩子</span>
            <p>{topic.hook}</p>
          </div>
        )}
        <div className="brief-block">
          <span className="brief-k">标签</span>
          <div className="chip-row">
            <span className="tag">{topic.genre || '未定题材'}</span>
            <span className="tag t-amber">{platformLabel(topic.platform)}</span>
            {(topic.tags || []).map((x) => (
              <span key={x} className="tag t-teal">
                {x}
              </span>
            ))}
          </div>
        </div>
        {(topic.refWorks || []).filter((r) => r.name).length > 0 && (
          <div className="brief-block">
            <span className="brief-k">对标</span>
            <ul className="brief-list">
              {topic.refWorks
                .filter((r) => r.name)
                .map((r, i) => (
                  <li key={i}>
                    <b>{r.name}</b>
                    {r.why ? `：${r.why}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        )}
        <div className="brief-block">
          <span className="brief-k">节奏</span>
          <p className="hint">
            {topic.plan?.targetWords?.toLocaleString()} 字目标 · 日更{' '}
            {topic.plan?.dailyWords?.toLocaleString()} 字
            {topic.plan?.publishAt ? ` · 计划 ${topic.plan.publishAt.toLocaleString()} 字上架` : ''}
          </p>
        </div>
        <button className="btn btn-block" onClick={onOpen}>
          编辑选题
        </button>
      </div>
    </aside>
  );
}
