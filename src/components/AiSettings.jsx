import React from 'react';
import { api } from '../api.js';

const PRESETS = [
  { key: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'openai', label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'qwen', label: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { key: 'zhipu', label: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { key: 'ollama', label: 'Ollama 本地', base: 'http://localhost:11434/v1', model: 'llama3' },
];

const NEW = '__new__';

/**
 * AI 设置弹窗：支持配置多个模型（provider）并在它们之间切换生效。
 * 存到 data/ai-config.json，覆盖 .env。Key 明文只进不出（后端只回掩码）。
 */
export default function AiSettings({ initial, onClose, onSaved, onImgSaved }) {
  const [cfg, setCfg] = React.useState(initial || null);
  const [sel, setSel] = React.useState(null); // 编辑中的模型 id，NEW 表示新增
  const [name, setName] = React.useState('');
  const [base, setBase] = React.useState('');
  const [model, setModel] = React.useState('');
  const [key, setKey] = React.useState('');
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');

  // 对话模型「测试是否可用」
  const [chatTesting, setChatTesting] = React.useState(null); // 正在测试的 id 或 'form'
  const [chatTest, setChatTest] = React.useState(null); // 测试结果 { ok, ms, error }
  const [chatTestFor, setChatTestFor] = React.useState(null); // 结果归属：id 或 'form'

  // 一键测试全部模型（对话 + 图片）
  const [allTesting, setAllTesting] = React.useState(false);
  const [allRes, setAllRes] = React.useState(null); // { ok, failed, total, results }

  // 封面图片模型（多模态文生图，支持多个）
  const [img, setImg] = React.useState(null);
  const [imgSel, setImgSel] = React.useState(null); // 编辑中的图片模型 id，NEW 表示新增
  const [imgName, setImgName] = React.useState('');
  const [imgBase, setImgBase] = React.useState('');
  const [imgModel, setImgModel] = React.useState('');
  const [imgKey, setImgKey] = React.useState('');
  const [imgShowKey, setImgShowKey] = React.useState(false);
  const [imgSaving, setImgSaving] = React.useState(false);
  const [imgMsg, setImgMsg] = React.useState('');
  const [imgErr, setImgErr] = React.useState('');
  const [imgTesting, setImgTesting] = React.useState(null); // 正在测试的 id 或 'form'
  const [imgTest, setImgTest] = React.useState(null); // 测试结果 { ok, ms, error }
  const [imgTestFor, setImgTestFor] = React.useState(null); // 结果归属：id 或 'form'

  const providers = cfg?.providers || [];
  const hasKey = !!(sel && sel !== NEW && providers.find((p) => p.id === sel)?.hasKey);

  async function refresh(next) {
    const r = next || (await api.aiConfig());
    setCfg(r);
    onSaved?.(r);
    return r;
  }

  React.useEffect(() => {
    // 打开即拉全量（含 providers），首次用 initial 兜底避免闪白
    api.aiConfig()
      .then(refresh)
      .catch(() => {});
    api.imageConfig()
      .then((r) => {
        setImg(r);
        setImgBase(r.base || '');
        setImgModel(r.model || '');
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runImg(payload, okMsg) {
    setImgSaving(true);
    setImgMsg('');
    setImgErr('');
    try {
      const r = await api.saveImageConfig(payload);
      setImg(r);
      setImgMsg(okMsg);
      setImgKey('');
      onImgSaved?.(r);
    } catch (e) {
      setImgErr(e.message || '保存失败');
    } finally {
      setImgSaving(false);
    }
  }

  function fillImgFrom(p, isNew) {
    setImgSel(isNew ? NEW : p.id);
    setImgName(p?.name || '');
    setImgBase(p?.baseURL || '');
    setImgModel(p?.model || '');
    setImgKey('');
    setImgMsg('');
    setImgErr('');
    setImgTest(null);
    setImgTestFor(null);
  }

  function startNewImg() {
    setImgName('');
    setImgBase('');
    setImgModel('');
    setImgKey('');
    setImgSel(NEW);
    setImgMsg('');
    setImgErr('');
    setImgTest(null);
    setImgTestFor(null);
  }

  function removeImg(id) {
    if (!window.confirm('删除这个图片模型配置？')) return;
    setImgSaving(true);
    setImgErr('');
    api.saveImageConfig({ op: 'delete', id })
      .then(async (r) => {
        setImg(r);
        if (imgSel === id) {
          setImgSel(null);
          setImgName('');
          setImgBase('');
          setImgModel('');
          setImgKey('');
        }
        setImgMsg('已删除');
      })
      .catch((e) => setImgErr(e.message || '删除失败'))
      .finally(() => setImgSaving(false));
  }

  function activateImg(id) {
    return runImg({ op: 'activate', id }, '已切换生效图片模型');
  }

  async function saveImage() {
    const provider = { name: imgName, baseURL: imgBase, model: imgModel };
    if (imgKey) provider.apiKey = imgKey;
    if (imgSel === NEW) return runImg({ op: 'add', provider }, '已新增并设为生效中');
    if (!imgSel) return setImgErr('请先选择一个图片模型，或点「新增图片模型」');
    return runImg({ op: 'update', id: imgSel, provider }, '已保存');
  }

  async function testFormImg() {
    if (!imgBase && !imgModel) { setImgErr('请先填写网关和模型名再测试'); return; }
    setImgTesting('form');
    setImgTestFor('form');
    setImgTest(null);
    setImgErr('');
    try {
      const r = await api.testImageConfig({ baseURL: imgBase, model: imgModel, apiKey: imgKey });
      setImgTest(r);
    } catch (e) {
      setImgTest({ ok: false, error: e.message || '测试失败' });
    } finally {
      setImgTesting(null);
    }
  }

  async function testStoredImg(id) {
    setImgTesting(id);
    setImgTestFor(id);
    setImgTest(null);
    setImgErr('');
    try {
      const r = await api.testImageConfig({ id });
      setImgTest(r);
    } catch (e) {
      setImgTest({ ok: false, error: e.message || '测试失败' });
    } finally {
      setImgTesting(null);
    }
  }

  function fillFrom(p, isNew) {
    setSel(isNew ? NEW : p.id);
    setName(p?.name || '');
    setBase(p?.baseURL || '');
    setModel(p?.model || '');
    setKey('');
    setMsg('');
    setErr('');
    setChatTest(null);
    setChatTestFor(null);
  }

  function startNew(preset) {
    setName(preset ? preset.label : '');
    setBase(preset?.base || '');
    setModel(preset?.model || '');
    setKey('');
    setSel(NEW);
    setMsg('');
    setErr('');
    setChatTest(null);
    setChatTestFor(null);
  }

  async function run(payload, okMsg) {
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const r = await api.saveAiConfig(payload);
      await refresh(r);
      setMsg(okMsg);
      setKey('');
    } catch (e) {
      setErr(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function save() {
    const provider = { name, baseURL: base, model };
    if (key) provider.apiKey = key;
    if (sel === NEW) return run({ op: 'add', provider }, '已新增并设为生效中');
    if (!sel) return setErr('请先选择一个模型，或点「新增模型」');
    return run({ op: 'update', id: sel, provider }, '已保存');
  }

  function remove(id) {
    if (!window.confirm('删除这个模型配置？')) return;
    setSaving(true);
    setErr('');
    api.saveAiConfig({ op: 'delete', id })
      .then(async (r) => {
        await refresh(r);
        if (sel === id) {
          // 删掉的正是在编辑的那条 → 收起编辑区
          setSel(null);
          setName('');
          setBase('');
          setModel('');
          setKey('');
        }
        setMsg('已删除');
      })
      .catch((e) => setErr(e.message || '删除失败'))
      .finally(() => setSaving(false));
  }

  function activate(id) {
    return run({ op: 'activate', id }, '已切换生效模型');
  }

  async function testFormChat() {
    if (!base && !model) { setErr('请先填写网关和模型名再测试'); return; }
    setChatTesting('form');
    setChatTestFor('form');
    setChatTest(null);
    setErr('');
    try {
      const r = await api.testChatConfig({ baseURL: base, model, apiKey: key });
      setChatTest(r);
    } catch (e) {
      setChatTest({ ok: false, error: e.message || '测试失败' });
    } finally {
      setChatTesting(null);
    }
  }

  async function testStoredChat(id) {
    setChatTesting(id);
    setChatTestFor(id);
    setChatTest(null);
    setErr('');
    try {
      const r = await api.testChatConfig({ id });
      setChatTest(r);
    } catch (e) {
      setChatTest({ ok: false, error: e.message || '测试失败' });
    } finally {
      setChatTesting(null);
    }
  }

  async function testAllModels() {
    setAllTesting(true);
    setAllRes(null);
    setErr('');
    try {
      const r = await api.testAllModels();
      setAllRes(r);
    } catch (e) {
      setErr(e.message || '批量测试失败');
    } finally {
      setAllTesting(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>AI 设置</b>
          <button className="icon-btn" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            可添加多个模型（DeepSeek / 通义 / 智谱 / 本地 Ollama 等），随时切换哪台生效。
            信息只保存在本机 <code>data/ai-config.json</code>，不会上传；Key 明文只进不出。
          </p>

          {/* 一键体检：把对话 + 图片所有已配置模型全测一遍 */}
          <div className="ai-testall">
            <button className="btn small" disabled={allTesting} onClick={testAllModels}>
              {allTesting ? '正在测试全部模型…' : '一键测试全部模型（对话 + 图片）'}
            </button>
            {allTesting && <span className="hint ai-testall-tip">并发测试中，图片模型较慢，请稍候（通常 10～30 秒）…</span>}
            {allRes && !allTesting && (
              <>
                <p className="ai-testall-sum">
                  共 {allRes.total} 个：<b className="ok">{allRes.ok} 个可用</b>
                  {allRes.failed > 0 && <b className="err"> · {allRes.failed} 个不可用</b>}
                </p>
                <div className="ai-testall-list">
                  {(allRes.results || []).map((r) => (
                    <div className={`ai-test-result ${r.ok ? 'ok' : 'err'}`} key={`${r.type}-${r.id}`}>
                      <b>{r.name}</b>
                      <span className="ai-badge">{r.type === 'image' ? '图片' : '对话'}</span>
                      <span className="ai-testall-model">{r.model}</span>
                      <span className="ai-testall-verdict">
                        {r.ok ? `✓ 可用（${r.ms}ms）` : `✗ ${r.error}`}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 模型列表：切换生效 / 编辑 / 删除 */}
          <div className="ai-prov-list">
            {!providers.length && <p className="hint">还没有配置任何模型，先在下面新增一个。</p>}
            {providers.map((p) => (
              <div
                className={`ai-prov ${p.active ? 'on' : ''} ${sel === p.id ? 'editing' : ''}`}
                key={p.id}
                onClick={() => fillFrom(p, false)}
              >
                <div className="ai-prov-main">
                  <div className="ai-prov-name">
                    <b>{p.name}</b>
                    {p.active && <span className="ai-badge">生效中</span>}
                    {!p.ready && <span className="ai-badge warn">未填全</span>}
                  </div>
                  <div className="ai-prov-meta">
                    {p.model || '（未填模型）'} · {p.baseURL || '（未填网关）'}
                    {p.hasKey ? ` · Key ${p.keyMask}` : ' · 未填 Key'}
                  </div>
                </div>
                <div className="ai-prov-ops">
                  <button
                    className="btn small"
                    disabled={chatTesting}
                    onClick={(e) => {
                      e.stopPropagation();
                      testStoredChat(p.id);
                    }}
                  >
                    {chatTesting === p.id ? '测试中…' : '测试'}
                  </button>
                  {!p.active && (
                    <button
                      className="btn small"
                      disabled={saving}
                      onClick={(e) => {
                        e.stopPropagation();
                        activate(p.id);
                      }}
                    >
                      设为生效
                    </button>
                  )}
                  <button
                    className="link-btn danger"
                    disabled={saving}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(p.id);
                    }}
                  >
                    删除
                  </button>
                </div>
                {chatTestFor === p.id && chatTest && (
                  <div className={`ai-test-result ${chatTest.ok ? 'ok' : 'err'}`}>
                    {chatTest.ok ? `✓ 可用（${chatTest.model}，${chatTest.ms}ms）` : `✗ 失败：${chatTest.error}`}
                  </div>
                )}
              </div>
            ))}
            <button className="btn small" disabled={saving} onClick={() => startNew(null)} style={{ alignSelf: 'flex-start' }}>
              + 新增模型
            </button>
          </div>

          {/* 编辑区：新增或编辑选中的模型 */}
          {(sel || sel === NEW) && (
            <div className="ai-editor">
              <h4>{sel === NEW ? '新增模型' : `编辑：${name || '未命名'}`}</h4>

              <div className="ai-preset-row">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    className="chip"
                    onClick={() => {
                      if (sel === NEW) setName(p.label);
                      setBase(p.base);
                      setModel(p.model);
                    }}
                    title={`${p.base} · ${p.model}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <label>名称（给自己看的备注）</label>
              <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：本地 4B / DeepSeek 主力" />

              <label>API 网关（Base URL）</label>
              <input className="inp" value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://api.openai.com/v1" />

              <label>模型名</label>
              <input className="inp" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" />

              <label>API Key</label>
              <div className="ai-key-row">
                <input
                  className="inp"
                  type={showKey ? 'text' : 'password'}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={hasKey ? '留空则保留已保存的 Key' : '不需要 Key 的服务（如 Ollama）可留空'}
                />
                <button className="link-btn" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? '隐藏' : '显示'}
                </button>
              </div>
              {hasKey && <p className="hint ai-key-state">已保存：{providers.find((p) => p.id === sel)?.keyMask}</p>}

              <div className="ai-actions">
                <button className="btn primary" disabled={saving} onClick={save}>
                  {saving ? '保存中…' : sel === NEW ? '新增并生效' : '保存'}
                </button>
                <button className="btn ghost" disabled={saving || chatTesting} onClick={testFormChat}>
                  {chatTesting === 'form' ? '测试中…' : '测试'}
                </button>
                <button className="btn ghost" disabled={saving} onClick={() => { setSel(null); setMsg(''); setErr(''); }}>
                  取消
                </button>
              </div>
              {chatTestFor === 'form' && chatTest && (
                <p className={`ai-test-result ${chatTest.ok ? 'ok' : 'err'}`}>
                  {chatTest.ok ? `✓ 可用（${chatTest.model}，${chatTest.ms}ms）` : `✗ 失败：${chatTest.error}`}
                </p>
              )}
            </div>
          )}

          {/* 生效中状态 */}
          {cfg?.activeId ? (
            <p className="ai-state ok">
              当前生效：{cfg.activeName || '未命名'} · 网关 {cfg.base} · 模型 {cfg.model}
              {!cfg.hasKey && ' · 未填 Key（本地模型可如此）'}
            </p>
          ) : (
            <p className="err">还没有生效的模型，续写与 AI 工具不可用。</p>
          )}

          {err && <p className="err">{err}</p>}
          {msg && <p className="hint">{msg}</p>}

          <div className="ai-actions">
            <span className="spacer" />
            <button className="link-btn" onClick={onClose}>
              关闭
            </button>
          </div>
          <p className="hint ai-tip">本地 Ollama 等不需要 Key 的服务，Key 可留空。切换模型即时生效，不用重启服务。</p>

          {/* 封面图片模型（多模态文生图，支持多个） */}
          <div className="ai-image-block">
            <h4>封面图片模型（可选 · 多模态文生图）</h4>
            <p className="hint">
              可添加多个文生图模型（OpenAI gpt-image / DALL·E、Agnes Image、本地 ComfyUI/SD 等），
              随时切换哪台生效，并「测试连通性」验证网关、Key 与模型名是否正确。普通对话模型不能生图。
            </p>

            {/* 列表：切换生效 / 测试 / 删除 */}
            <div className="ai-prov-list">
              {(!img?.providers || !img.providers.length) && (
                <p className="hint">还没有配置任何图片模型，先在下面新增一个。</p>
              )}
              {(img?.providers || []).map((p) => (
                <div
                  className={`ai-prov ${p.active ? 'on' : ''} ${imgSel === p.id ? 'editing' : ''}`}
                  key={p.id}
                  onClick={() => fillImgFrom(p, false)}
                >
                  <div className="ai-prov-main">
                    <div className="ai-prov-name">
                      <b>{p.name}</b>
                      {p.active && <span className="ai-badge">生效中</span>}
                      {!p.ready && <span className="ai-badge warn">未填全</span>}
                    </div>
                    <div className="ai-prov-meta">
                      {p.model || '（未填模型）'} · {p.baseURL || '（未填网关）'}
                      {p.hasKey ? ` · Key ${p.keyMask}` : ' · 未填 Key'}
                    </div>
                  </div>
                  <div className="ai-prov-ops">
                    {!p.active && (
                      <button className="btn small" disabled={imgSaving} onClick={(e) => { e.stopPropagation(); activateImg(p.id); }}>设为生效</button>
                    )}
                    <button className="btn small" disabled={imgTesting} onClick={(e) => { e.stopPropagation(); testStoredImg(p.id); }}>
                      {imgTesting === p.id ? '测试中…' : '测试连通性'}
                    </button>
                    <button className="link-btn danger" disabled={imgSaving} onClick={(e) => { e.stopPropagation(); removeImg(p.id); }}>删除</button>
                  </div>
                  {imgTestFor === p.id && imgTest && (
                    <div className={`ai-test-result ${imgTest.ok ? 'ok' : 'err'}`}>
                      {imgTest.ok ? `✓ 连通成功（${imgTest.model}，${imgTest.ms}ms）` : `✗ 失败：${imgTest.error}`}
                    </div>
                  )}
                </div>
              ))}
              <button className="btn small" disabled={imgSaving} onClick={startNewImg} style={{ alignSelf: 'flex-start' }}>
                + 新增图片模型
              </button>
            </div>

            {/* 编辑区：新增或编辑选中的图片模型 */}
            {(imgSel || imgSel === NEW) && (
              <div className="ai-editor">
                <h4>{imgSel === NEW ? '新增图片模型' : `编辑：${imgName || '未命名'}`}</h4>
                <label>名称（给自己看的备注）</label>
                <input className="inp" value={imgName} onChange={(e) => setImgName(e.target.value)} placeholder="例：Agnes 生图 / 本地 SD" />
                <label>图片网关（Base URL）</label>
                <input className="inp" value={imgBase} onChange={(e) => setImgBase(e.target.value)} placeholder="https://api.agnes-ai.cn/v1/images/generations" />
                <label>图片模型名</label>
                <input className="inp" value={imgModel} onChange={(e) => setImgModel(e.target.value)} placeholder="agnes-image-2.5-flash" />
                <label>API Key（如需）</label>
                <div className="ai-key-row">
                  <input
                    className="inp"
                    type={imgShowKey ? 'text' : 'password'}
                    value={imgKey}
                    onChange={(e) => setImgKey(e.target.value)}
                    placeholder={img?.providers?.find((p) => p.id === imgSel)?.hasKey ? '留空则保留已保存的 Key' : '部分服务可留空'}
                  />
                  <button className="link-btn" onClick={() => setImgShowKey((s) => !s)}>{imgShowKey ? '隐藏' : '显示'}</button>
                </div>
                {img?.providers?.find((p) => p.id === imgSel)?.hasKey && (
                  <p className="hint ai-key-state">已保存：{img.providers.find((p) => p.id === imgSel)?.keyMask}</p>
                )}
                <div className="ai-actions">
                  <button className="btn primary" disabled={imgSaving} onClick={saveImage}>
                    {imgSaving ? '保存中…' : imgSel === NEW ? '新增并生效' : '保存'}
                  </button>
                  <button className="btn ghost" disabled={imgTesting} onClick={testFormImg}>
                    {imgTesting === 'form' ? '测试中…' : '测试连通性'}
                  </button>
                  <button
                    className="btn ghost"
                    disabled={imgSaving || imgTesting}
                    onClick={() => { setImgSel(null); setImgMsg(''); setImgErr(''); setImgTest(null); setImgTestFor(null); }}
                  >
                    取消
                  </button>
                </div>
                {imgTestFor === 'form' && imgTest && (
                  <p className={`ai-test-result ${imgTest.ok ? 'ok' : 'err'}`}>
                    {imgTest.ok ? `✓ 连通成功（${imgTest.model}，${imgTest.ms}ms）` : `✗ 失败：${imgTest.error}`}
                  </p>
                )}
              </div>
            )}

            {imgErr && <p className="err">{imgErr}</p>}
            {imgMsg && <p className="hint">{imgMsg}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
