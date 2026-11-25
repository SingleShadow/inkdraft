import http from 'node:http';

const MOCK = {
  topic: {
    title: '冒烟测试书', logline: '落魄主角觉醒签到系统逆袭', protagonist: '林远',
    hook: '退婚羞辱后系统激活，结尾抛悬念', channel: 'male', genre: '都市', platform: 'fanqie',
    tags: ['系统流', '逆袭'], audience: '网文读者', refWorks: [{ name: '对标书', why: '抄节奏' }],
  },
  outline: {
    background: '都市背景，豪门林家', theme: '逆袭与自我证明',
    mainline: '起因（被退婚）→冲突（家族打压）→目标（翻身）→驱动力（签到系统）→闭环（登顶）',
    branches: '支线：红颜知己线、商战线', hidden: '暗线：生母死因',
    stages: '开局立足→成长→受挫→高潮', timeline: '约三年', ending: '大结局登顶', endingType: '大团圆',
    backup: '写偏就回系统任务', selling: '签到流差异化',
  },
  chars: {
    chars: [
      { name: '林远', gender: '男', camp: '己方', appearance: '清瘦', personality: '沉稳隐忍', cause: '幼年寄人篱下', goal: '活下去并证明自己', realGoal: '查清生母死因', flaw: '冲动', habit: '敲桌', arc: '从隐忍到掌控', relation: '与苏婉有羁绊' },
      { name: '苏婉', gender: '女', camp: '己方', appearance: '温婉', personality: '聪慧', cause: '', goal: '家族复兴', realGoal: '', flaw: '心软', habit: '', arc: '从被动到主动', relation: '林远盟友' },
      { name: '林傲', gender: '男', camp: '敌方', appearance: '倨傲', personality: '跋扈', cause: '', goal: '夺家产', realGoal: '', flaw: '轻敌', habit: '', arc: '从盛到败', relation: '林远堂兄' },
    ],
  },
  volumes: [
    { title: '第一卷·潜龙在渊', summary: '主角觉醒系统，立足都市', goal: '站稳脚跟', keyEvents: ['退婚受辱', '系统激活', '小试身手'], conflict: '家族打压', endState: '初露锋芒', tone: '热血', chaptersPerVolume: 15 },
    { title: '第二卷·风云渐起', summary: '商战与势力扩张', goal: '建立势力', keyEvents: ['商战开局', '结交盟友'], conflict: '对手反扑', endState: '势力成型', tone: '紧张', chaptersPerVolume: 18 },
    { title: '第三卷·登顶之路', summary: '收网与终极对决', goal: '登顶', keyEvents: ['真相揭开', '最终决战'], conflict: '生死局', endState: '登顶', tone: '悲壮', chaptersPerVolume: 20 },
  ],
  chapters: [
    { title: '苏醒', plot: '开场在病房，林远醒来发现签到系统激活，遭遇退婚羞辱，结尾抛下悬念', words: 1200, hook: '门外传来脚步声', beat: '开篇' },
    { title: '反击', plot: '林远用签到神物当场打脸，收获第一批追随者，结尾发现更大阴谋', words: 1200, hook: '暗处有人冷笑', beat: '小高潮' },
  ],
  chapter: { title: '苏醒', text: '铁锈味钻进鼻腔。林远睁开眼，指节泛白——门外传来脚步声，伴随着一声冷笑：「废物也配姓林？」', hook: '门外有人' },
};

function pick(system = '') {
  if (system.includes('本章剧情蓝图')) return MOCK.chapter;
  if (system.includes('三层大纲体系的第三层')) return MOCK.chapters;
  if (system.includes('分卷大纲')) return MOCK.volumes;
  if (system.includes('人物设定师')) return MOCK.chars;
  if (system.includes('background(故事背景')) return MOCK.outline;
  if (system.includes('网文策划') || system.includes('选题') || system.includes('小说策划') || system.includes('网文主编')) return MOCK.topic;
  return MOCK.topic;
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let system = '';
    try {
      const j = JSON.parse(body || '{}');
      const msgs = Array.isArray(j.messages) ? j.messages : [];
      system = (msgs.find((m) => m.role === 'system') || {}).content || '';
    } catch {}
    const payload = pick(system);
    const out = JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(out);
  });
});
server.listen(8799, () => console.log('mock-ai on 8799'));
