const BASE = 'http://localhost:8787';
async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}
const log = (...a) => console.log('•', ...a);

(async () => {
  // 1) AI 选题
  log('aiTopic ...');
  const topic = await j('POST', '/api/ai/topic', { seed: '一个被退婚的废柴，觉醒签到系统每天领神物，靠种田基建逆袭', channel: 'male', platform: 'fanqie', mode: 'new' });
  console.log('  选题:', topic.title, '/', topic.logline);

  // 2) 建作品
  const work = await j('POST', '/api/works', { title: '冒烟测试书_一键成书', topicId: null });
  log('createWork id=', work.id);

  // 3) compose start（scratch：无 topicId，outline 为空）
  let r = await j('POST', `/api/works/${work.id}/compose/start`);
  console.log('  start stage =', r.plan.stage, '| outline?', !!r.plan.outline);

  // 4) 写入 topic 字段到 plan（模拟向导编辑），再生成大纲
  await j('POST', `/api/works/${work.id}/compose/save`, { patch: { topic } });
  log('composeStep outline ...');
  r = await j('POST', `/api/works/${work.id}/compose/step`, { step: 'outline' });
  const o = r.plan.outline;
  console.log('  outline keys:', Object.keys(o).filter((k) => o[k]).join(','));
  if (!o.mainline) throw new Error('outline.mainline 为空');

  // 5) 分卷
  log('composeStep volumes ...');
  r = await j('POST', `/api/works/${work.id}/compose/step`, { step: 'volumes', targetVolumes: 3 });
  console.log('  volumes:', r.plan.volumes.map((v) => v.title).join(' | '));
  if (!r.plan.volumes.length) throw new Error('volumes 为空');

  // 6) 同步成作品卷
  r = await j('POST', `/api/works/${work.id}/compose/sync-volumes`);
  console.log('  synced workVolumeId:', r.plan.volumes.map((v) => v.workVolumeId).join(','));

  // 7) 第一卷章纲（2 章）
  const v0 = r.plan.volumes[0];
  log('composeStep chapters (v0, 2章) ...');
  r = await j('POST', `/api/works/${work.id}/compose/step`, { step: 'chapters', volumeId: v0.id, chaptersPerVolume: 2 });
  console.log('  v0 chapters:', r.plan.volumes[0].chapters.map((c) => c.title).join(' | '));
  if (r.plan.volumes[0].chapters.length !== 2) throw new Error('章纲数量不对');

  // 8) 写两章
  for (const c of r.plan.volumes[0].chapters) {
    log('composeChapter', c.title, '...');
    const w = await j('POST', `/api/works/${work.id}/compose/chapter`, { volumeId: v0.id, planChapterId: c.id });
    console.log('   写了《' + w.title + '》', w.wordCount, '字');
    if (!w.wordCount) throw new Error('章节正文为空');
  }

  // 9) 校验作品章节数 & 字数
  const w2 = await j('GET', `/api/works/${work.id}`);
  const totalCh = w2.volumes.reduce((n, v) => n + v.chapters.length, 0);
  const totalWc = w2.volumes.reduce((n, v) => n + v.chapters.reduce((m, c) => m + (c.wordCount || 0), 0), 0);
  console.log('  作品现共', totalCh, '章，', totalWc, '字');
  if (totalCh < 2) throw new Error('落盘章节数不足');

  // 10) 删除测试作品
  await j('DELETE', `/api/works/${work.id}`);
  console.log('✅ 端到端通过，已清理测试作品');
})().catch((e) => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});
