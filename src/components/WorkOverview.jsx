import React from 'react';
import { api } from '../api.js';
import { platformLabel } from './Home.jsx';

const CHANNEL_LABEL = { male: '男频', female: '女频' };

function genCoverPrompt(work = {}, settings = {}, topic = null) {
  const title = work.title || '未命名作品';
  const genre = work.genre || '';
  const channel = work.channel || (topic?.channel === 'female' ? '女频' : '男频');
  const kw = [];
  const main =
    Array.isArray(settings?.characters) && settings.characters.length
      ? settings.characters.find((c) => c.role === '主角') || settings.characters[0]
      : null;
  if (main) {
    if (main.appearance) kw.push(main.appearance.slice(0, 40));
    if (main.personality) kw.push(main.personality.slice(0, 20));
  }
  if (Array.isArray(settings?.world) && settings.world[0]) {
    const w0 = settings.world[0];
    if (w0?.name) kw.push(w0.name);
  }
  const keyLine = kw.length ? `，画面元素：${kw.slice(0, 3).join('、')}` : '';
  const genreLine = genre ? `，题材：${genre}` : '';
  const chanLine = channel ? `，适配${channel}审美` : '';
  return `小说《${title}》封面插画，电影感主视觉，精致厚涂风格，构图聚焦、氛围感强、光影层次丰富，画面中无文字无标题${genreLine}${chanLine}${keyLine}。`;
}

export default function WorkOverview({ work, wordCount = 0, settings, topic, aiCfg, imgCfg, onOpenChapter, onStartWrite, onOpenTopic, onOpenAiSettings, onCompose }) {
  const [cover, setCover] = React.useState(null);
  const [coverBusy, setCoverBusy] = React.useState(false);
  const [coverErr, setCoverErr] = React.useState('');
  const [showPrompt, setShowPrompt] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');
  const [ts, setTs] = React.useState(0);
  const [preview, setPreview] = React.useState(false);
  const [zoom, setZoom] = React.useState(false);

  // 预览：ESC 关闭，滚轮/按钮切换 1:1 放大
  React.useEffect(() => {
    if (!preview) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (zoom) setZoom(false);
        else setPreview(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, zoom]);

  const s = settings || {};
  const chars = Array.isArray(s.characters) ? s.characters : [];
  const world = Array.isArray(s.world) ? s.world : [];
  const outlineCount = Array.isArray(s.outline) ? s.outline.length : 0;
  const totalChapters = (work.volumes || []).reduce((n, v) => n + (v.chapters ? v.chapters.length : 0), 0);
  const imgReady = imgCfg && imgCfg.enabled;

  React.useEffect(() => {
    setCover(coverUrl());
    setCoverErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work?.id]);

  function coverUrl() {
    return api.coverUrl(work.id) + `?t=${Date.now()}`;
  }
  function refreshCover() {
    setCover(coverUrl());
    setTs(Date.now());
  }

  async function genCover() {
    setCoverBusy(true);
    setCoverErr('');
    try {
      const r = await api.aiCover(work.id, prompt.trim());
      refreshCover();
      setShowPrompt(false);
    } catch (e) {
      setCoverErr(e.message || '生成失败');
    } finally {
      setCoverBusy(false);
    }
  }

  const defaultPrompt = genCoverPrompt(work, s, topic);

  return (
    <div className="overview">
      <div className="ov-cover">
        <div className={`ov-cover-img ${cover && !coverErr ? 'has' : ''}`}>
          {cover && !coverErr ? (
            <img
              src={cover}
              alt="封面"
              key={ts}
              onClick={() => setPreview(true)}
              title="点击查看大图"
              onError={() => setCover(null)}
            />
          ) : (
            <div className="ov-cover-empty">
              <span>暂无封面</span>
              <small>用多模态模型生成</small>
            </div>
          )}
        </div>
        <div className="ov-cover-ops">
          <button
            className="btn small primary"
            disabled={!imgReady || coverBusy}
            onClick={() => {
              setPrompt(defaultPrompt);
              setShowPrompt((v) => !v);
            }}
            title={imgReady ? '用多模态文生图模型生成封面' : '先在 AI 设置里配置封面图片模型'}
          >
            {coverBusy ? '生成中…' : cover ? '重新生成' : '生成封面'}
          </button>
          {cover && (
            <>
              <button className="btn small" onClick={refreshCover}>
                刷新
              </button>
              <button className="btn small" onClick={() => setPreview(true)} title="看大图">
                预览
              </button>
            </>
          )}
          {!imgReady && (
            <button className="btn small ghost" onClick={onOpenAiSettings}>
              去配置图片模型
            </button>
          )}
          {coverErr && <p className="hint err">{coverErr}</p>}
          {showPrompt && (
            <div className="ov-prompt">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="封面提示词（中文，描述风格与画面元素）"
              />
              <div className="ov-prompt-ops">
                <button className="btn small primary" disabled={coverBusy} onClick={genCover}>
                  生成
                </button>
                <button className="btn small" onClick={() => { setPrompt(defaultPrompt); }}>
                  用默认
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ov-main">
        <h1 className="ov-title">{work.title}</h1>
        {work.logline && <p className="ov-logline">{work.logline}</p>}

        <div className="ov-meta">
          <span className="tag">{work.genre || '未定题材'}</span>
          <span className="tag">{CHANNEL_LABEL[work.channel] || (topic?.channel === 'female' ? '女频' : '男频')}</span>
          <span className="tag t-amber">{platformLabel(work.targetPlatform)}</span>
          {(work.tags || []).slice(0, 4).map((t) => (
            <span key={t} className="tag t-teal">{t}</span>
          ))}
        </div>

        <div className="ov-stats">
          <div><b>{(wordCount || work.wordCount || 0).toLocaleString()}</b><span>总字数</span></div>
          <div><b>{totalChapters}</b><span>章节</span></div>
          <div><b>{work.dailyGoal?.toLocaleString() || 0}</b><span>每日目标</span></div>
          <div><b>{Math.round((work.targetWords || 0) / 10000) || 0}万</b><span>目标字数</span></div>
        </div>

        <div className="ov-cols">
          <div className="ov-col">
            <h3>设定库</h3>
            <ul>
              <li>人物 <b>{chars.length}</b> 个{chars.find((c) => c.role === '主角') ? `（主角：${chars.find((c) => c.role === '主角').name}）` : ''}</li>
              <li>世界观 <b>{world.length}</b> 条</li>
              <li>大纲节点 <b>{outlineCount}</b> 个</li>
            </ul>
          </div>
          <div className="ov-col">
            <h3>一句话创意</h3>
            <p className="ov-block">{work.logline || '（还没写）'}</p>
            {topic && (
              <button className="btn small" onClick={onOpenTopic}>
                查看选题详情
              </button>
            )}
            {work.refWorks && work.refWorks.length > 0 && (
              <>
                <h3>对标作品</h3>
                <ul>
                  {work.refWorks.slice(0, 3).map((r, i) => (
                    <li key={i}>{r.name}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <div className="ov-actions">
          {totalChapters > 0 ? (
            <button className="btn primary" onClick={() => onOpenChapter(work.volumes[0].chapters[0].id)}>
              打开第一章
            </button>
          ) : (
            <button className="btn primary" onClick={onStartWrite}>
              开始写作（+ 新章节）
            </button>
          )}
          {onCompose && (
            <button className="btn compose-entry" onClick={onCompose} title="从本书选题/大纲继续：分卷→章纲→正文">
              ✦ 一键成书
            </button>
          )}
        </div>
      </div>

      {preview && cover && (
        <div className="ov-lightbox" onClick={() => setPreview(false)} role="dialog" aria-label="封面预览">
          <div className="ov-lb-inner" onClick={(e) => e.stopPropagation()}>
            <div className="ov-lb-bar">
              <span>《{work.title}》封面</span>
              <span className="spacer" />
              <button className="btn small" onClick={() => setZoom((z) => !z)}>
                {zoom ? '适应窗口' : '1:1 原始尺寸'}
              </button>
              <a className="btn small" href={cover} target="_blank" rel="noreferrer">
                新窗口打开
              </a>
              <button className="btn small" onClick={() => setPreview(false)}>
                关闭 (Esc)
              </button>
            </div>
            <div className={`ov-lb-stage ${zoom ? 'zoom' : ''}`}>
              <img src={cover} alt="封面大图" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
