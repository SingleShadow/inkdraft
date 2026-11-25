import { spawn } from 'node:child_process';

/** 同时启动 API（8787）与 Vite（5173）；Vite 已配置 /api 代理 */
const procs = [
  { name: 'api', cmd: process.execPath, args: ['server/index.js'], color: '\x1b[36m' },
  {
    name: 'web',
    cmd: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['vite'],
    color: '\x1b[35m',
  },
];

const children = procs.map((p) => {
  const child = spawn(p.cmd, p.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `${p.color}[${p.name}]\x1b[0m`;
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  child.on('exit', (code) => {
    console.log(`${tag} 退出(code=${code})`);
    children.forEach((c) => c.kill());
    process.exit(code ?? 0);
  });
  return child;
});

process.on('SIGINT', () => children.forEach((c) => c.kill()));
