import React from 'react';
import { api } from '../api.js';

const PLATFORMS = [
  ['fanqie', '番茄'],
  ['qidian', '起点'],
  ['jinjiang', '晋江'],
  ['qimao', '七猫'],
  ['feilu', '飞卢'],
  ['free', '自由'],
];
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS);

/**
 * AI 选题生成弹窗，两种用法：
 *  - mode="create"（首页）：输入方向 → AI 出完整选题 → 采用并建选题
 *  - mode="fill"（选题详情）：基于已有内容 → AI 补全空白字段 → 应用到选题
 * 未配置 AI 时只提示去设置，绝不静默失败。
 */
export default function TopicAi({ mode = 'create', topic = null, aiConfigStatus, onOpenSettings, onClose, onAdopt, onApply }) {
  const [seed, setSeed] = React.useState('');
  const [channel, setChannel] = React.useState(topic?.channel || 'male');
  const [platform, setPlatform] = React.useState(topic?.platform || 'fanqie');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [result, setResult] = React.useState(null);

  const ready = aiConfigStatus?.ready || aiConfigStatus?.configured;

  async function generate() {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const r = await api.aiTopic({
        seed,
        channel,
        platform,
        mode: mode === 'fill' ? 'fill' : 'new',
        current:
          mode === 'fill' && topic
            ? {
                title: topic.title,
                logline: topic.logline,
                protagonist: topic.protagonist,
                hook: topic.hook,
                channel: topic.channel,
                genre: topic.genre,
                platform: topic.platform,
                tags: topic.tags,
                audience: topic.audience,
                refWorks: topic.refWorks,
              }
            : null,
      });
      setResult(r);
    } catch (e) {
      setError(e.message || '生成失败');
    } finally {
      setLoading(false);
    }
  }

  const isFill = mode === 'fill';

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{isFill ? 'AI 补全选题' : 'AI 生成选题'}</h3>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        {!ready ? (
          <div className="modal-body">
            <p className="err">AI 未配置，无法生成。先在「AI 设置」里填好网关与 Key。</p>
            <button className="btn" onClick={onOpenSettings}>
              去设置
            </button>
          </div>
        ) : (
          <div className="modal-body">
            {!isFill && (
              <>
                <label className="field-label">想写点什么？（关键词 / 题材 / 一句话灵感）</label>
                <textarea
                  className="tp-logline"
                  rows={3}
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="例：想写一本主角靠「每日签到」白手起家的都市爽文，带点职场逆袭"
                />
                <div className="tp-sec two" style={{ padding: 0, marginTop: 12 }}>
                  <div>
                    <label className="field-label">频道</label>
                    <div className="chip-row">
                      <button className={`chip ${channel === 'male' ? 'on' : ''}`} onClick={() => setChannel('male')}>
                        男频
                      </button>
                      <button className={`chip ${channel === 'female' ? 'on' : ''}`} onClick={() => setChannel('female')}>
                        女频
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="field-label">目标平台</label>
                    <div className="chip-row">
                      {PLATFORMS.map(([id, label]) => (
                        <button
                          key={id}
                          className={`chip ${platform === id ? 'on' : ''}`}
                          onClick={() => setPlatform(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {isFill && <p className="hint">会基于下方已有内容，补全空白或太短的字段；你已定的频道 / 平台 / 题材不会被 AI 翻转。</p>}

            <div className="modal-actions">
              <button className="btn primary" disabled={loading} onClick={generate}>
                {loading ? '生成中…' : isFill ? '补全缺失项' : '生成选题'}
              </button>
              {result && (
                <button className="btn" disabled={loading} onClick={generate}>
                  换一个
                </button>
              )}
            </div>

            {error && <p className="err">{error}</p>}

            {result && (
              <div className="ai-topic-preview">
                <TopicPreview r={result} />
                <div className="modal-actions">
                  {isFill ? (
                    <button className="btn primary" onClick={() => onApply(result)}>
                      应用到选题
                    </button>
                  ) : (
                    <button className="btn primary" onClick={() => onAdopt(result)}>
                      采用并建选题
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TopicPreview({ r }) {
  return (
    <div className="tp-preview">
      {r.logline && (
        <div className="brief-block">
          <span className="brief-k">一句话创意</span>
          <p>{r.logline}</p>
        </div>
      )}
      {r.protagonist && (
        <div className="brief-block">
          <span className="brief-k">主角</span>
          <p>{r.protagonist}</p>
        </div>
      )}
      {r.hook && (
        <div className="brief-block">
          <span className="brief-k">黄金三章钩子</span>
          <p>{r.hook}</p>
        </div>
      )}
      <div className="brief-block">
        <span className="brief-k">标签</span>
        <div className="chip-row">
          <span className="tag">{r.channel === 'female' ? '女频' : '男频'}</span>
          {r.genre && <span className="tag">{r.genre}</span>}
          <span className="tag t-amber">{PLATFORM_LABEL[r.platform] || r.platform}</span>
          {(r.tags || []).map((x) => (
            <span key={x} className="tag t-teal">
              {x}
            </span>
          ))}
        </div>
      </div>
      {r.audience && (
        <div className="brief-block">
          <span className="brief-k">目标读者</span>
          <p>{r.audience}</p>
        </div>
      )}
      {(r.refWorks || []).filter((x) => x.name).length > 0 && (
        <div className="brief-block">
          <span className="brief-k">对标</span>
          <ul className="brief-list">
            {r.refWorks
              .filter((x) => x.name)
              .map((x, i) => (
                <li key={i}>
                  <b>{x.name}</b>
                  {x.why ? `：${x.why}` : ''}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
