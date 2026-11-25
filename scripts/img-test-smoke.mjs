// 临时冒烟测试：图片模型多配置 + 连通性测试（不碰真实 data 目录）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inkdraft-img-'));
process.env.INKDRAFT_DATA = tmp;

// --- 启动 mock 图片网关：根据 body 是否含 extra_body 决定返回 Agnes / OpenAI 形态 ---
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ok = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST') return ok(405, {});
    let p = {};
    try { p = JSON.parse(body || '{}'); } catch { /* ignore */ }
    ok(200, { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' }] });
  });
});
await new Promise((r) => mock.listen(0, r));
const port = mock.address().port;
const agn = `http://127.0.0.1:${port}/v1/images/generations`; // 含完整路径，验证不再重复拼
const open = `http://127.0.0.1:${port}/v1`; // 只给到 /v1，验证自动补全

const { testImageConnection } = await import('../server/ai.js');
const store = await import('../server/store.js');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { (cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗', name, extra))); };

console.log('--- 连通性测试 ---');
const rAgn = await testImageConnection({ base: agn, key: 'x', model: 'agnes-image-2.5-flash' });
check('Agnes(base 含完整路径) 连通成功', rAgn.ok, JSON.stringify(rAgn));
const rOpen = await testImageConnection({ base: open, key: 'x', model: 'dall-e-3' });
check('OpenAI(base 仅 /v1) 自动补全并成功', rOpen.ok, JSON.stringify(rOpen));
const rBad = await testImageConnection({ base: 'http://127.0.0.1:9', model: 'x' });
check('错误网关返回 ok:false 且有 error', !rBad.ok && !!rBad.error, JSON.stringify(rBad));
const rMiss = await testImageConnection({ base: '', model: '' });
check('缺参数直接返回 ok:false', !rMiss.ok);

console.log('--- 多模型配置 CRUD ---');
let c = await store.saveImageConfig({ op: 'add', provider: { name: 'Agnes', baseURL: agn, model: 'agnes-image-2.5-flash', apiKey: 'k1' } });
check('add 后 providers=1 且生效', c.providers.length === 1 && c.providers[0].active, JSON.stringify(c.providers.map(p => p.active)));
const id1 = c.providers[0].id;
c = await store.saveImageConfig({ op: 'add', provider: { name: 'Local', baseURL: open, model: 'sd-xl' } });
check('add 第二个后 providers=2', c.providers.length === 2);
const id2 = c.providers.find((p) => p.name === 'Local').id;
check('第二个未自动生效(仍 id1)', c.activeId === id1, c.activeId);
c = await store.saveImageConfig({ op: 'activate', id: id2 });
check('activate 切换到 id2', c.activeId === id2 && c.activeName === 'Local');
c = await store.saveImageConfig({ op: 'update', id: id1, provider: { name: 'Agnes2', model: 'agnes-image-2.5-flash' } });
check('update 改了名字', c.providers.find((p) => p.id === id1).name === 'Agnes2');
c = await store.saveImageConfig({ op: 'delete', id: id1 });
check('delete 后 providers=1 且 active 落到剩余', c.providers.length === 1 && c.activeId === id2);

console.log('--- 兼容旧单条 image 字段迁移 ---');
fs.writeFileSync(path.join(tmp, 'ai-config.json'), JSON.stringify({ image: { enabled: true, baseURL: agn, model: 'agnes-image-2.5-flash', apiKey: 'legacy' } }));
const migrated = store.getImageConfig();
check('遗留 image 字段迁移成 providers', migrated.providers.length === 1 && migrated.providers[0].active && migrated.model === 'agnes-image-2.5-flash');

console.log('--- 载入生效配置供生成使用 ---');
const eff = store.loadImageConfig();
check('loadImageConfig 返回生效模型 base/model/key', eff.base === agn && eff.model === 'agnes-image-2.5-flash' && eff.key === 'legacy', JSON.stringify(eff));

mock.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
