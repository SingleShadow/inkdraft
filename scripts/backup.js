import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

/** 独立备份：把 data/ 复制到 backups/<时间戳>/data（不依赖服务运行） */
const DATA = path.resolve(process.cwd(), 'data');
const BACKUPS = path.resolve(process.cwd(), 'backups');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = path.join(BACKUPS, ts);

await mkdir(dest, { recursive: true });
await cp(DATA, path.join(dest, 'data'), { recursive: true });

const items = await readdir(BACKUPS);
console.log(`已备份 → ${dest}（当前共 ${items.length} 份）`);
