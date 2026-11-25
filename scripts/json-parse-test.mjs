import { parseJsonLoose } from '../server/ai.js';

const cases = [
  ['正常 JSON', '{"title":"失业联盟","tags":["a","b"]}'],
  ['代码块包裹', '```json\n{"title":"失业联盟","tags":["a"]}\n```'],
  ['前后有解释文字', '好的，这是你要的：\n{"title":"失业联盟"}\n希望对你有帮助！'],
  ['字符串里有真实换行', '{\n "title": "失业联盟",\n "hook": "第一章：他被裁了。\n第二章：系统上线。\n第三章：反杀。"\n}'],
  ['字符串里有多行段落（正文）', '{"title":"第一章","text":"第一段。\n\n第二段。\n\n第三段。","hook":"钩子"}'],
  ['被截断（尾括号缺失）', '{"title":"失业联盟","logline":"被裁员后觉醒系统","refWorks":[{"name":"《开局被裁员》"'],
  ['截断在最外层', '{"title":"失业联盟","tags":["系统流","逆袭"],"audience":"25-40岁男性'],
  ['尾随逗号', '{"title":"失业联盟","tags":["a","b",],}'],
  ['数组截断', '[{"title":"第一卷","summary":"走向"},{"title":"第二卷"'],
  ['thinking 块混入', '<thinking>让我思考一下…\n{"a":1}\n</thinking>\n{"title":"失业联盟"}'],
  ['中文引号+书名号', '{"title":"失业联盟","refWorks":[{"name":"《开局被裁员，我创建了神级公司》","why":"节奏可参考"}]}'],
  ['tab 缩进在字符串内', '{"hook":"第一行\t带制表符"}'],
  ['多余闭括号', '{"title":"a"}}\n'],
  ['值里夹带裸英文双引号', '{"background":"大厂裁员后沦为"无用之人"。林野所在的"星辰集团"是行业霸主，底层青年挣扎求生。","theme":"被抛弃的人也能互相照亮"}'],
  ['裸引号+真实换行混合', '{\n"hook":"第一章：他被裁了。\n第二章："系统"上线。\n",\n"channel":"male"\n}'],
  ['值内有中文逗号紧跟引号', '{"summary":"他说"好的"，然后离开了会议室，留下众人面面相觑。"}'],
  ['完全不是 JSON', '好的，我明白了，这就开始写作。'],
  ['空输入', ''],
];

let pass = 0;
let fail = 0;
for (const [name, input] of cases) {
  const expectArr = /数组截断/.test(name);
  let out;
  try {
    out = parseJsonLoose(input);
  } catch (e) {
    out = `THROW: ${e.message}`;
  }
  const shouldBeNull = /完全不是 JSON|空输入/.test(name);
  let good;
  if (shouldBeNull) good = out === null;
  else if (expectArr) good = Array.isArray(out) && out.length === 2;
  else good = !!out && typeof out === 'object' && !Array.isArray(out);
  if (good) pass += 1;
  else fail += 1;
  console.log(`${good ? '✓' : '✗'} ${name.padEnd(22)} -> ${out === null ? 'null（正确识别为非 JSON）' : JSON.stringify(out).slice(0, 110)}`);
}
console.log(`\n通过 ${pass} / ${pass + fail}`);
