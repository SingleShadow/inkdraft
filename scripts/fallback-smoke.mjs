// 验证 chat() 的多模型兜底：主模型额度耗尽/连不通时自动切到下一个可用模型。
// 通过 INKDRAFT_DATA 指向临时目录，避免污染真实数据。单次导入，单数据目录。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeMock(status, bodyObj) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bodyObj));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

const mockQuota = await makeMock(429, { error: 'insufficient_quota', message: 'quota' });
const mockOk = await makeMock(200, { choices: [{ message: { content: '兜底成功' } }] });
const pQ = mockQuota.address().port;
const pO = mockOk.address().port;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-fb-'));
const cfgPath = path.join(tmp, 'ai-config.json');
const writeCfg = (aPort, bPort) =>
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        providers: [
          { id: 'pa', name: '主模型', baseURL: `http://127.0.0.1:${aPort}`, model: 'm-a', apiKey: 'x' },
          { id: 'pb', name: '兜底模型', baseURL: `http://127.0.0.1:${bPort}`, model: 'm-b', apiKey: 'y' },
        ],
        activeId: 'pa',
      },
      null,
      2,
    ),
  );

process.env.INKDRAFT_DATA = tmp;
const ai = await import(`file://${path.resolve('server/ai.js')}`);

// Case A：主模型 429 → 兜底成功且 active 切到 pb
writeCfg(pQ, pO);
let okA = false;
let detA = '';
try {
  const r = await ai.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
  okA = r.includes('兜底');
  detA = `返回: ${JSON.stringify(r)}`;
} catch (e) {
  detA = `抛出: ${e.message}`;
}
const afterA = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const switched = afterA.activeId === 'pb';
console.log(`[CaseA 主模型额度耗尽] ${okA && switched ? 'PASS' : 'FAIL'} | 切换active=${switched} | ${detA}`);

// Case B：两个模型都 429 → 应抛「所有已配置模型均不可用」
writeCfg(pQ, pQ);
let okB = false;
let detB = '';
try {
  await ai.chat([{ role: 'user', content: 'hi' }], { maxTokens: 50 });
  detB = '未抛出（不符预期）';
} catch (e) {
  okB = /所有已配置模型均不可用/.test(e.message);
  detB = `抛出: ${e.message}`;
}
console.log(`[CaseB 全部模型失败] ${okB ? 'PASS' : 'FAIL'} | ${detB}`);

fs.rmSync(tmp, { recursive: true, force: true });
mockQuota.close();
mockOk.close();

if (!(okA && switched && okB)) process.exitCode = 1;
console.log(process.exitCode ? '\n❌ 兜底测试存在失败项' : '\n✅ 兜底测试全部通过');
