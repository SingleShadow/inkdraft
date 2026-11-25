import React from 'react';

export default function SidePanel({ snapshots, onSnapshot, onRestore, onClose, gitAvailable }) {
  return (
    <aside className="side">
      <div className="side-head">
        <b>章节快照</b>
        <button className="icon-btn" onClick={onClose} title="收起">
          ›
        </button>
      </div>
      <div className="side-body">
        <button className="btn btn-block" onClick={onSnapshot}>
          保存一个快照
        </button>
        {!snapshots.length && <p className="hint">还没有快照。手动保存或每 10 分钟会自动留档。</p>}
        {snapshots.map((s) => (
          <div key={s.ts} className="snap">
            <div className="snap-meta">
              <span>{new Date(s.ts).toLocaleString('zh-CN')}</span>
              <span className="tag">{s.trigger === 'manual' ? '手动' : '自动'}</span>
            </div>
            <div className="snap-actions">
              <span className="hint">{s.wordCount} 字</span>
              <button className="link-btn" onClick={() => onRestore(s.ts)}>
                恢复
              </button>
            </div>
          </div>
        ))}
        <div className="side-foot">
          <p className="hint">
            {gitAvailable
              ? '已启用 Git 版本镜像：data/ 目录自动提交，可用 git log / git diff 回溯。'
              : '未检测到 Git，版本镜像未启用（仍可使用快照）。'}
          </p>
        </div>
      </div>
    </aside>
  );
}
