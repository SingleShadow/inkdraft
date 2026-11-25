async function req(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  meta: () => req('/api/meta'),
  setMeta: (patch) => req('/api/meta', { method: 'PUT', body: JSON.stringify(patch) }),

  listTopics: () => req('/api/topics'),
  createTopic: (data) => req('/api/topics', { method: 'POST', body: JSON.stringify(data) }),
  getTopic: (id) => req(`/api/topics/${id}`),
  updateTopic: (id, patch) => req(`/api/topics/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteTopic: (id) => req(`/api/topics/${id}`, { method: 'DELETE' }),

  listWorks: async () => {
    const d = await req('/api/works');
    return Array.isArray(d) ? d : Array.isArray(d.works) ? d.works : [];
  },
  createWork: (data) => req('/api/works', { method: 'POST', body: JSON.stringify(data) }),
  getWork: (id) => req(`/api/works/${id}`),
  updateWork: (id, patch) => req(`/api/works/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteWork: (id) => req(`/api/works/${id}`, { method: 'DELETE' }),

  addVolume: (workId, title) => req(`/api/works/${workId}/volumes`, { method: 'POST', body: JSON.stringify({ title }) }),
  addChapter: (workId, volumeId, title) =>
    req(`/api/works/${workId}/volumes/${volumeId}/chapters`, { method: 'POST', body: JSON.stringify({ title }) }),
  deleteChapter: (workId, cid) => req(`/api/works/${workId}/chapters/${cid}`, { method: 'DELETE' }),
  renameChapter: (workId, cid, title) =>
    req(`/api/works/${workId}/chapters/${cid}/title`, { method: 'PUT', body: JSON.stringify({ title }) }),

  getChapter: (workId, cid) => req(`/api/works/${workId}/chapters/${cid}`),
  saveChapter: (workId, cid, data) =>
    req(`/api/works/${workId}/chapters/${cid}`, { method: 'PUT', body: JSON.stringify(data) }),

  snapshots: (workId, cid) => req(`/api/works/${workId}/chapters/${cid}/snapshots`),
  snapshot: (workId, cid) => req(`/api/works/${workId}/chapters/${cid}/snapshots`, { method: 'POST' }),
  readSnapshot: (workId, cid, ts) => req(`/api/works/${workId}/chapters/${cid}/snapshots/${ts}`),

  gitStatus: () => req('/api/git/status'),
  backup: () => req('/api/backup', { method: 'POST' }),
  backups: () => req('/api/backups'),

  getSettings: (workId) => req(`/api/works/${workId}/settings`),
  saveSettings: (workId, data) =>
    req(`/api/works/${workId}/settings`, { method: 'PUT', body: JSON.stringify(data) }),
  settingContext: (workId) => req(`/api/works/${workId}/settings/context`),

  aiConfig: () => req('/api/ai/config'),
  saveAiConfig: (data) => req('/api/ai/config', { method: 'PUT', body: JSON.stringify(data) }),
  imageConfig: () => req('/api/ai/image-config'),
  saveImageConfig: (data) => req('/api/ai/image-config', { method: 'POST', body: JSON.stringify(data) }),
  testImageConfig: (data) => req('/api/ai/image/test', { method: 'POST', body: JSON.stringify(data || {}) }),
  testChatConfig: (data) => req('/api/ai/chat/test', { method: 'POST', body: JSON.stringify(data || {}) }),
  testAllModels: () => req('/api/ai/test-all', { method: 'POST', body: JSON.stringify({}) }),
  aiCover: (workId, prompt) =>
    req(`/api/ai/cover`, { method: 'POST', body: JSON.stringify({ workId, prompt }) }),
  coverUrl: (workId) => `/api/works/${workId}/cover`,
  aiContinue: (workId, data) =>
    req(`/api/works/${workId}/ai/continue`, { method: 'POST', body: JSON.stringify(data) }),
  aiNextChapter: (workId, data) =>
    req(`/api/works/${workId}/ai/next-chapter`, { method: 'POST', body: JSON.stringify(data || {}) }),
  aiReview: (workId, data) => req(`/api/works/${workId}/ai/review`, { method: 'POST', body: JSON.stringify(data || {}) }),
  aiTopic: (data) => req('/api/ai/topic', { method: 'POST', body: JSON.stringify(data) }),
  aiNames: (data) => req('/api/ai/names', { method: 'POST', body: JSON.stringify(data) }),
  aiOutline: (data) => req('/api/ai/outline', { method: 'POST', body: JSON.stringify(data) }),
  aiChars: (data) => req('/api/ai/chars', { method: 'POST', body: JSON.stringify(data) }),
  aiFirstChapters: (data) => req('/api/ai/first-chapters', { method: 'POST', body: JSON.stringify(data) }),
  checkTitle: (title) => req('/api/title/check', { method: 'POST', body: JSON.stringify({ title }) }),

  /* 一键成书：五段式流水线 */
  composeStart: (workId) => req(`/api/works/${workId}/compose/start`, { method: 'POST' }),
  composePlan: (workId) => req(`/api/works/${workId}/compose/plan`),
  composeStep: (workId, step, payload = {}) =>
    req(`/api/works/${workId}/compose/step`, { method: 'POST', body: JSON.stringify({ step, ...payload }) }),
  composeSave: (workId, patch) =>
    req(`/api/works/${workId}/compose/save`, { method: 'POST', body: JSON.stringify({ patch }) }),
  composeSyncVolumes: (workId) => req(`/api/works/${workId}/compose/sync-volumes`, { method: 'POST' }),
  composeChapter: (workId, { volumeId, planChapterId, words }) =>
    req(`/api/works/${workId}/compose/chapter`, {
      method: 'POST',
      body: JSON.stringify({ volumeId, planChapterId, ...(words ? { words: Number(words) } : {}) }),
    }),

  selfcheck: (workId) => req(`/api/works/${workId}/selfcheck`),

  exportUrl: (workId) => `/api/works/${workId}/export.txt`,
};

/** 与后端一致的字数口径：去空白后的字符数 */
export function countWords(text) {
  if (!text) return 0;
  return text.replace(/\s/g, '').length;
}
