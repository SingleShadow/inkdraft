import { execFile } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Git 镜像：把 data/ 目录当成一个 Git 仓库，保存后自动 commit。
 * 收益：diff / 回溯 / 误删恢复全部免费，且 JSON 损坏时仍有 .md 文本兜底。
 * Git 不可用时静默降级（只告警一次），不影响写作。
 */

const REPO = path.resolve(process.cwd(), 'data');
let warned = false;
let pending = null;
let timer = null;

function run(args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: REPO, windowsHide: true }, (err, stdout) => {
      resolve({ ok: !err, out: (stdout || '').trim() });
    });
  });
}

export async function ensureRepo() {
  if (!existsSync(path.join(REPO, '.git'))) {
    const r = await run(['init']);
    if (!r.ok) {
      if (!warned) {
        warned = true;
        console.warn('[git] 未检测到 git，已跳过版本镜像（不影响写作，但建议安装 git）');
      }
      return false;
    }
    await run(['config', 'user.email', 'inkdraft@local']);
    await run(['config', 'user.name', 'InkDraft']);
    // data 目录里可能混入备份/临时文件，这里不做 .gitignore，保持简单
  }
  return true;
}

export async function isAvailable() {
  const r = await run(['rev-parse', '--is-inside-work-tree']);
  return r.ok && r.out === 'true';
}

/** 节流提交：频繁保存不会每 2 秒产生一个 commit */
export function scheduleCommit(message) {
  pending = message;
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    await commitNow(pending);
    pending = null;
  }, 3000);
}

export async function commitNow(message = 'chore: auto save') {
  if (!(await isAvailable())) return false;
  await run(['add', '-A']);
  const status = await run(['status', '--porcelain']);
  if (!status.out) return false; // 无变更
  const r = await run(['commit', '-m', message]);
  return r.ok;
}

export async function listCommits(limit = 50) {
  if (!(await isAvailable())) return [];
  const r = await run(['log', `--max-count=${limit}`, '--pretty=format:%H|%ct|%s']);
  if (!r.ok) return [];
  return r.out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, ts, subject] = line.split('|');
      return { hash, ts: Number(ts) * 1000, subject };
    });
}

export async function showFileAt(hash, relPath) {
  if (!(await isAvailable())) return null;
  return new Promise((resolve) => {
    execFile(
      'git',
      ['show', `${hash}:${relPath}`],
      { cwd: REPO, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout)
    );
  });
}
