import React from 'react';

const uid = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

const WORLD_CATEGORIES = ['力量体系', '地理', '势力', '历史', '物品', '习俗', '其他'];
const CHAR_ROLES = ['主角', '重要配角', '普通配角', '反派', '龙套'];
const OUTLINE_TYPES = [
  { value: 'volume', label: '卷', name: '卷纲' },
  { value: 'chapter', label: '章', name: '章纲' },
  { value: 'beat', label: '段', name: '片段' },
];
const typeLabel = (t) => OUTLINE_TYPES.find((x) => x.value === t)?.label || '';

const EMPTY_CHAR = () => ({
  id: uid(),
  name: '',
  role: '主角',
  emoji: '👤',
  gender: '',
  age: '',
  appearance: '',
  personality: '',
  background: '',
  motivation: '',
  weakness: '',
  catchphrase: '',
  arc: '',
  relations: [],
  note: '',
});

/* ---------------- 设定面板：人物 / 世界观 / 大纲 ---------------- */

export default function SettingsPanel({ work, initial, onSave, onClose }) {
  const [tab, setTab] = React.useState('char');
  const [data, setData] = React.useState(() => ({
    characters: [],
    world: [],
    outline: [],
    ...initial,
  }));
  const [selChar, setSelChar] = React.useState(null);
  const [selWorld, setSelWorld] = React.useState(null);
  const [selOutline, setSelOutline] = React.useState(null);

  // 防抖保存（与选题详情一致：改动后 800ms 落盘）
  React.useEffect(() => {
    const t = setTimeout(() => onSave(data), 800);
    return () => clearTimeout(t);
  }, [data, onSave]);

  const update = (patch) => setData((d) => ({ ...d, ...patch }));

  /* ---- 人物 ---- */
  const updateChar = (id, patch) =>
    setData((d) => ({
      ...d,
      characters: d.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  const addChar = () => {
    const c = EMPTY_CHAR();
    setData((d) => ({ ...d, characters: [...d.characters, c] }));
    setSelChar(c.id);
  };
  const delChar = (id) => {
    setData((d) => ({ ...d, characters: d.characters.filter((c) => c.id !== id) }));
    setSelChar((s) => (s === id ? null : s));
  };
  const addRel = (id) =>
    updateChar(id, {
      relations: [...(data.characters.find((c) => c.id === id)?.relations || []), { id: uid(), name: '', type: '', note: '' }],
    });
  const updateRel = (id, rid, patch) =>
    updateChar(id, {
      relations: (data.characters.find((c) => c.id === id)?.relations || []).map((r) =>
        r.id === rid ? { ...r, ...patch } : r
      ),
    });
  const delRel = (id, rid) =>
    updateChar(id, {
      relations: (data.characters.find((c) => c.id === id)?.relations || []).filter((r) => r.id !== rid),
    });

  /* ---- 世界观 ---- */
  const addWorld = (category) => {
    const item = { id: uid(), category, title: '', content: '' };
    setData((d) => ({ ...d, world: [...d.world, item] }));
    setSelWorld(item.id);
  };
  const updateWorld = (id, patch) =>
    setData((d) => ({ ...d, world: d.world.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  const delWorld = (id) => {
    setData((d) => ({ ...d, world: d.world.filter((w) => w.id !== id) }));
    setSelWorld((s) => (s === id ? null : s));
  };

  /* ---- 大纲（自引用树） ---- */
  const childrenOf = (pid) =>
    data.outline
      .filter((o) => (o.parentId || 'root') === pid)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  const addOutline = (parentId, type) => {
    const node = {
      id: uid(),
      type,
      title: type === 'volume' ? '新卷纲' : type === 'chapter' ? '新章纲' : '新片段',
      parentId: parentId === 'root' ? null : parentId,
      content: '',
      targetWords: 0,
      linkedChapterId: null,
      order: childrenOf(parentId).length,
    };
    setData((d) => ({ ...d, outline: [...d.outline, node] }));
    setSelOutline(node.id);
  };
  const updateOutline = (id, patch) =>
    setData((d) => ({ ...d, outline: d.outline.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const delOutline = (id) =>
    setData((d) => {
      const toDelete = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const o of d.outline) {
          if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
            toDelete.add(o.id);
            changed = true;
          }
        }
      }
      return { ...d, outline: d.outline.filter((o) => !toDelete.has(o.id)) };
    });
  const moveOutline = (id, dir) =>
    setData((d) => {
      const node = d.outline.find((o) => o.id === id);
      if (!node) return d;
      const sibs = childrenOf(node.parentId || 'root');
      const i = sibs.findIndex((o) => o.id === id);
      const j = i + dir;
      if (j < 0 || j >= sibs.length) return d;
      const a = sibs[i];
      const b = sibs[j];
      return {
        ...d,
        outline: d.outline.map((o) => {
          if (o.id === a.id) return { ...o, order: b.order };
          if (o.id === b.id) return { ...o, order: a.order };
          return o;
        }),
      };
    });

  const chapters = (work?.volumes || []).flatMap((v) => v.chapters || []);
  const chapterName = (cid) => chapters.find((c) => c.id === cid)?.title || '';

  const selC = data.characters.find((c) => c.id === selChar) || null;
  const selW = data.world.find((w) => w.id === selWorld) || null;
  const selO = data.outline.find((o) => o.id === selOutline) || null;

  return (
    <aside className="side">
      <div className="side-head">
        <b>设定库</b>
        <button className="icon-btn" onClick={onClose} title="收起">
          ›
        </button>
      </div>
      <div className="side-body set-body">
        <div className="set-tabs">
          <button className={`set-tab ${tab === 'char' ? 'on' : ''}`} onClick={() => setTab('char')}>
            人物 <i>{data.characters.length}</i>
          </button>
          <button className={`set-tab ${tab === 'world' ? 'on' : ''}`} onClick={() => setTab('world')}>
            世界观 <i>{data.world.length}</i>
          </button>
          <button className={`set-tab ${tab === 'outline' ? 'on' : ''}`} onClick={() => setTab('outline')}>
            大纲 <i>{data.outline.length}</i>
          </button>
        </div>

        {tab === 'char' && (
          <CharsTab
            data={data}
            sel={selC}
            selId={selChar}
            onSelect={setSelChar}
            onAdd={addChar}
            onDel={delChar}
            onUpdate={updateChar}
            onAddRel={addRel}
            onUpdateRel={updateRel}
            onDelRel={delRel}
          />
        )}

        {tab === 'world' && (
          <WorldTab
            data={data}
            sel={selW}
            selId={selWorld}
            onSelect={setSelWorld}
            onAdd={addWorld}
            onDel={delWorld}
            onUpdate={updateWorld}
          />
        )}

        {tab === 'outline' && (
          <OutlineTab
            data={data}
            sel={selO}
            selId={selOutline}
            chapters={chapters}
            chapterName={chapterName}
            childrenOf={childrenOf}
            onSelect={setSelOutline}
            onAdd={addOutline}
            onDel={delOutline}
            onUpdate={updateOutline}
            onMove={moveOutline}
          />
        )}
      </div>
    </aside>
  );
}

/* ---------------- 人物 Tab ---------------- */

function CharsTab({ data, sel, selId, onSelect, onAdd, onDel, onUpdate, onAddRel, onUpdateRel, onDelRel }) {
  return (
    <div className="set-pane">
      <button className="btn btn-block" onClick={onAdd}>
        ＋ 新人物
      </button>
      <div className="set-list">
        {data.characters.map((c) => (
          <div
            key={c.id}
            className={`set-item ${c.id === selId ? 'on' : ''}`}
            onClick={() => onSelect(c.id)}
          >
            <span className="emoji">{c.emoji || '👤'}</span>
            <span className="set-item-name">{c.name || '未命名'}</span>
            <span className="set-item-sub">{c.role}</span>
          </div>
        ))}
        {!data.characters.length && <p className="hint">还没有人物。先建一个主角吧。</p>}
      </div>

      {sel && (
        <div className="set-editor">
          <div className="field-row">
            <input
              className="emoji-input"
              value={sel.emoji || ''}
              maxLength={2}
              onChange={(e) => onUpdate(sel.id, { emoji: e.target.value })}
              title="头像（emoji）"
            />
            <input
              className="grow"
              placeholder="姓名"
              value={sel.name}
              onChange={(e) => onUpdate(sel.id, { name: e.target.value })}
            />
            <select value={sel.role} onChange={(e) => onUpdate(sel.id, { role: e.target.value })}>
              {CHAR_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <input placeholder="性别" value={sel.gender} onChange={(e) => onUpdate(sel.id, { gender: e.target.value })} />
            <input placeholder="年龄" value={sel.age} onChange={(e) => onUpdate(sel.id, { age: e.target.value })} />
          </div>
          <Field label="外貌" value={sel.appearance} onChange={(v) => onUpdate(sel.id, { appearance: v })} />
          <Field label="性格" value={sel.personality} onChange={(v) => onUpdate(sel.id, { personality: v })} />
          <Field label="出身 / 背景" value={sel.background} onChange={(v) => onUpdate(sel.id, { background: v })} />
          <Field label="目标 / 动机" value={sel.motivation} onChange={(v) => onUpdate(sel.id, { motivation: v })} />
          <Field label="弱点 / 恐惧" value={sel.weakness} onChange={(v) => onUpdate(sel.id, { weakness: v })} />
          <Field label="口头禅" value={sel.catchphrase} onChange={(v) => onUpdate(sel.id, { catchphrase: v })} />
          <Field label="人物弧光 / 成长线" value={sel.arc} onChange={(v) => onUpdate(sel.id, { arc: v })} />

          <div className="rel-block">
            <div className="rel-head">
              <span>人物关系</span>
              <button className="link-btn" onClick={() => onAddRel(sel.id)}>
                ＋
              </button>
            </div>
            {(sel.relations || []).map((r) => (
              <div key={r.id} className="rel-row">
                <input placeholder="对象" value={r.name} onChange={(e) => onUpdateRel(sel.id, r.id, { name: e.target.value })} />
                <input placeholder="关系" value={r.type} onChange={(e) => onUpdateRel(sel.id, r.id, { type: e.target.value })} />
                <button className="icon-btn danger" onClick={() => onDelRel(sel.id, r.id)}>
                  ×
                </button>
              </div>
            ))}
          </div>

          <Field label="备注" value={sel.note} onChange={(v) => onUpdate(sel.id, { note: v })} />
          <button className="link-btn danger" onClick={() => onDel(sel.id)}>
            删除这个人物
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- 世界观 Tab ---------------- */

function WorldTab({ data, sel, selId, onSelect, onAdd, onDel, onUpdate }) {
  const byCat = WORLD_CATEGORIES.map((cat) => ({
    cat,
    items: data.world.filter((w) => w.category === cat),
  })).filter((g) => g.items.length);
  const others = data.world.filter((w) => !WORLD_CATEGORIES.includes(w.category));

  return (
    <div className="set-pane">
      <div className="set-add-row">
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">＋ 新增条目…</option>
          {WORLD_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__other">其他</option>
        </select>
      </div>

      <div className="set-list">
        {[...byCat, { cat: '其他', items: others }].map((g) => (
          <div key={g.cat} className="set-group">
            <div className="set-group-title">{g.cat}</div>
            {g.items.map((w) => (
              <div
                key={w.id}
                className={`set-item ${w.id === selId ? 'on' : ''}`}
                onClick={() => onSelect(w.id)}
              >
                <span className="set-item-name">{w.title || '未命名'}</span>
              </div>
            ))}
          </div>
        ))}
        {!data.world.length && <p className="hint">还没有世界观条目。按分类整理力量体系、地图、势力等。</p>}
      </div>

      {sel && (
        <div className="set-editor">
          <div className="field-row">
            <select value={sel.category} onChange={(e) => onUpdate(sel.id, { category: e.target.value })}>
              {WORLD_CATEGORIES.concat(others.length && !WORLD_CATEGORIES.includes(sel.category) ? [sel.category] : []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input className="grow" placeholder="名称" value={sel.title} onChange={(e) => onUpdate(sel.id, { title: e.target.value })} />
          </div>
          <Field label="描述" value={sel.content} onChange={(v) => onUpdate(sel.id, { content: v })} area />
          <button className="link-btn danger" onClick={() => onDel(sel.id)}>
            删除这条
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- 大纲 Tab（树） ---------------- */

function OutlineTab({ data, sel, selId, chapters, chapterName, childrenOf, onSelect, onAdd, onDel, onUpdate, onMove }) {
  const renderNode = (node, depth) => {
    const kids = childrenOf(node.id);
    return (
      <div key={node.id}>
        <div
          className={`out-node ${node.id === selId ? 'on' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => onSelect(node.id)}
        >
          <span className={`out-badge b-${node.type}`}>{typeLabel(node.type)}</span>
          <span className="out-title">{node.title || '未命名'}</span>
          {node.linkedChapterId && <span className="out-link" title={chapterName(node.linkedChapterId)}>🔗</span>}
        </div>
        {kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div className="set-pane">
      <div className="set-add-row">
        <button className="btn small" onClick={() => onAdd('root', 'volume')}>
          ＋ 卷纲
        </button>
        {sel && (
          <button className="btn small" onClick={() => onAdd(sel.id, sel.type === 'volume' ? 'chapter' : 'beat')}>
            ＋ 下级
          </button>
        )}
      </div>

      <div className="out-tree">
        {childrenOf('root').map((n) => renderNode(n, 0))}
        {!data.outline.length && (
          <p className="hint">还没有大纲。先建一个卷纲，再往里加章纲 / 片段。</p>
        )}
      </div>

      {sel && (
        <div className="set-editor">
          <div className="field-row">
            <span className={`out-badge b-${sel.type}`}>{typeLabel(sel.type)}</span>
            <input className="grow" placeholder="标题" value={sel.title} onChange={(e) => onUpdate(sel.id, { title: e.target.value })} />
          </div>
          <Field label="内容 / 要点" value={sel.content} onChange={(v) => onUpdate(sel.id, { content: v })} area />
          <div className="field-row">
            <input
              type="number"
              min="0"
              placeholder="目标字数"
              value={sel.targetWords || ''}
              onChange={(e) => onUpdate(sel.id, { targetWords: Number(e.target.value) || 0 })}
            />
            <select
              value={sel.linkedChapterId || ''}
              onChange={(e) => onUpdate(sel.id, { linkedChapterId: e.target.value || null })}
            >
              <option value="">不关联章节</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="out-actions">
            <button className="link-btn" onClick={() => onMove(sel.id, -1)}>
              ↑ 上移
            </button>
            <button className="link-btn" onClick={() => onMove(sel.id, 1)}>
              ↓ 下移
            </button>
            <button className="link-btn danger" onClick={() => onDel(sel.id)}>
              删除（含下级）
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- 通用 Field ---------------- */

function Field({ label, value, onChange, area }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {area ? (
        <textarea rows={3} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
