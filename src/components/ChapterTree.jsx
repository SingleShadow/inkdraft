import React from 'react';

export default function ChapterTree({ work, currentId, onSelect, onAddChapter, onAddVolume, onDeleteChapter }) {
  if (!work) return null;
  return (
    <div className="tree">
      {work.volumes.map((vol) => (
        <div key={vol.id} className="tree-vol">
          <div className="tree-vol-title">
            <span>{vol.title}</span>
          </div>
          {vol.chapters.map((ch) => (
            <div
              key={ch.id}
              className={`tree-ch ${ch.id === currentId ? 'on' : ''}`}
              onClick={() => onSelect(ch.id)}
            >
              <span className="tree-ch-title">{ch.title}</span>
              <span className="tree-ch-words">{ch.wordCount || 0}</span>
              <button
                className="icon-btn"
                title="删除章节"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`删除《${ch.title}》？可在快照/Git 中恢复。`)) onDeleteChapter(ch.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button className="tree-add" onClick={() => onAddChapter(vol.id)}>
            + 新章节
          </button>
        </div>
      ))}
      <button className="tree-add tree-add-vol" onClick={onAddVolume}>
        + 新卷
      </button>
    </div>
  );
}
