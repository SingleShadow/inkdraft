import React from 'react';

const PLATFORM_LABEL = {
  fanqie: '番茄',
  qidian: '起点',
  jinjiang: '晋江',
  qimao: '七猫',
  feilu: '飞卢',
  free: '自由',
};
const CHANNEL_LABEL = { male: '男频', female: '女频' };
const STATUS_LABEL = {
  idea: '灵感池',
  candidate: '候选',
  adopted: '已开书',
  dropped: '已放弃',
};

export function platformLabel(p) {
  return PLATFORM_LABEL[p] || '自由';
}

export default function Home({ topics, works, aiCfg, onCreateTopic, onOpenTopic, onOpenWork, onDeleteWork, onDeleteTopic, onOpenAiSettings, onOpenTopicAiGen, onComposeScratch }) {
  const [idea, setIdea] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function submit(e) {
    e.preventDefault();
    const v = idea.trim();
    if (!v) return;
    setBusy(true);
    // 先用创意原句做选题名（截断到 18 字），进详情再改成好记的名字
    const t = await onCreateTopic({ title: v.slice(0, 18), logline: v });
    setIdea('');
    setBusy(false);
    if (t) onOpenTopic(t.id);
  }

  const topicList = Array.isArray(topics) ? topics : [];
  const workList = Array.isArray(works) ? works : [];
  const active = topicList.filter((t) => t.status !== 'dropped');
  const dropped = topicList.filter((t) => t.status === 'dropped');

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1>墨稿</h1>
          <p className="sub">先想清楚写什么，再想书名。书名随时能改，题材选错写到三十万字才发现就晚了。</p>
        </div>
        <button className="home-ai-btn" onClick={onOpenAiSettings} title="配置 AI 网关与 Key">
          <span className={`dot ${aiCfg?.configured || aiCfg?.ready ? 'on' : 'off'}`} />
          {aiCfg?.configured || aiCfg?.ready ? 'AI 已配置' : 'AI 未配置'}
        </button>
      </div>

      <form className="idea-box" onSubmit={submit}>
        <input
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="一句话创意：谁，陷在什么处境里，靠什么翻身？"
          autoFocus
        />
        <button className="btn primary" disabled={busy || !idea.trim()}>
          {busy ? '创建中…' : '建选题'}
        </button>
        <button type="button" className="btn" onClick={onOpenTopicAiGen} title="让 AI 帮你起一个完整选题">
          AI 生成
        </button>
        <button type="button" className="btn compose-entry" onClick={onComposeScratch} title="从一句话创意直接成书：大纲→分卷→章纲→正文">
          ✦ 一键成书
        </button>
      </form>
      <p className="idea-hint">
        例：一个被全网嘲讽的废物，每天签到都能拿到一件神级物品——先写句子，书名后面再说。
      </p>

      <section className="home-sec">
        <h2>
          选题库 <span className="count">{active.length}</span>
        </h2>
        {!active.length ? (
          <p className="empty">还没有选题。上面写一句话，回车即可。</p>
        ) : (
          <div className="topic-grid">
            {active.map((t) => (
              <div key={t.id} className="topic-card" onClick={() => onOpenTopic(t.id)}>
                <div className="tc-top">
                  <b>{t.title}</b>
                  {!!t.eval && (
                    <span className={`score s-${t.eval.verdict.level}`}>
                      {t.eval.value} · {t.eval.verdict.label}
                    </span>
                  )}
                </div>
                <p className="tc-logline">{t.logline || '（还没写一句话创意）'}</p>
                <div className="tc-tags">
                  <span className="tag">{CHANNEL_LABEL[t.channel] || '男频'}</span>
                  {!!t.genre && <span className="tag">{t.genre}</span>}
                  <span className="tag t-amber">{platformLabel(t.platform)}</span>
                  {(t.tags || []).slice(0, 3).map((x) => (
                    <span key={x} className="tag t-teal">
                      {x}
                    </span>
                  ))}
                </div>
                <div className="tc-foot">
                  <span className="hint">
                    {t.status === 'adopted' && t.workId
                      ? `已开书 · ${(workList.find((w) => w.id === t.workId) || {}).title || ''}`
                      : STATUS_LABEL[t.status]}
                  </span>
                  <button
                    className="icon-btn danger"
                    title="放弃这个选题"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`放弃选题「${t.title}」？可在底部「已放弃」里找回（此处为软删除）。`)) {
                        onDeleteTopic(t.id);
                      }
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!!dropped.length && (
          <details className="dropped">
            <summary>已放弃 {dropped.length}</summary>
            <div className="dropped-list">
              {dropped.map((t) => (
                <span key={t.id} className="chip dropped-chip">
                  <span onClick={() => onOpenTopic(t.id)}>{t.title}</span>
                  <button
                    className="icon-btn danger"
                    title="永久删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPurgeTopic(t.id);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </details>
        )}
      </section>

      <section className="home-sec">
        <h2>
          作品 <span className="count">{workList.length}</span>
        </h2>
        {!workList.length ? (
          <p className="empty">选题定了才会出现作品。</p>
        ) : (
          <div className="work-grid">
            {workList.map((w) => (
              <div key={w.id} className="work-card" onClick={() => onOpenWork(w.id)}>
                <div className="work-card-title">{w.title}</div>
                {!!w.logline && <div className="work-card-logline">{w.logline}</div>}
                <div className="work-card-meta">
                  {w.wordCount.toLocaleString()} 字 · {w.chapterCount} 章
                  {!!w.targetWords && (
                    <>
                      {' · '}
                      {Math.min(100, Math.round((w.wordCount / w.targetWords) * 100))}%
                    </>
                  )}
                </div>
                <div className="tc-tags">
                  {!!w.genre && <span className="tag">{w.genre}</span>}
                  <span className="tag t-amber">{platformLabel(w.targetPlatform)}</span>
                </div>
                <button
                  className="icon-btn danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`删除《${w.title}》及其所有章节？`)) onDeleteWork(w.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
