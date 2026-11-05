/**
 * doctor 模块测试：健康/不健康项目评分。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runDoctor, isSeparatorDecoration } = require('../src/doctor');

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zh-skills-doctor-'));
}

function write(dir, relPath, content) {
  const file = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

/** 构造一个符合中文工程规范的健康项目 */
function makeHealthyProject() {
  const dir = makeTemp();
  write(dir, 'README.md', `# demo-app\n\n一个演示项目，用于展示中文工程规范。\n\n## 快速开始\n\nnpm install\nnpm run dev\n`);
  write(dir, 'LICENSE', 'MIT License');
  write(dir, 'CHANGELOG.md', '# Changelog\n\n## 0.1.0\n- 初始版本\n');
  write(dir, 'CLAUDE.md', '# CLAUDE.md\n\n## 命令\n\nnpm test\nnpm run build\n');
  write(dir, '.claude/skills/commit-zh/SKILL.md', '---\nname: commit-zh\ndescription: x\n---\n');
  write(dir, '.gitignore', 'node_modules\n');
  write(dir, '.prettierrc', '{}\n');
  write(dir, 'src/index.js', 'function calcTotal(amount, count) {\n  return amount * count;\n}\nmodule.exports = { calcTotal };\n');
  return dir;
}

/** 构造一个不规范项目：拼音命名、无文档、无 CLAUDE.md、console.log 泛滥 */
function makeUnhealthyProject() {
  const dir = makeTemp();
  write(dir, 'src/app.js', 'const jine = 100;\nconst shijian = Date.now();\nconsole.log(jine);\nconsole.log(shijian);\nconsole.log("debug1");\nconsole.log("debug2");\nconsole.log("debug3");\nconsole.log("debug4");\n');
  return dir;
}

test('健康项目应得高分（>= 90）', () => {
  const dir = makeHealthyProject();
  try {
    const report = runDoctor(dir);
    assert.ok(report.total >= 90, `期望 >=90，实际 ${report.total}`);
    assert.strictEqual(report.problems.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('不规范项目应得低分（< 50）并报出问题', () => {
  const dir = makeUnhealthyProject();
  try {
    const report = runDoctor(dir);
    assert.ok(report.total < 50, `期望 <50，实际 ${report.total}`);
    assert.ok(report.problems.length > 0);
    // 拼音命名应被检出
    assert.ok(report.problems.some((p) => p.key === 'name' && /拼音/.test(p.msg)), '未检出拼音命名');
    // CLAUDE.md 缺失应被检出
    assert.ok(report.problems.some((p) => p.key === 'ai' && /CLAUDE/.test(p.msg)), '未检出 CLAUDE.md 缺失');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('README 翻译腔会被检出', () => {
  const dir = makeTemp();
  write(dir, 'README.md', '# demo\n\n本工具通过对数据进行一个排序的操作。\n请注意，我们需要确保数据正确。\n');
  try {
    const report = runDoctor(dir);
    assert.ok(report.problems.some((p) => p.key === 'doc' && /翻译腔/.test(p.msg)), '未检出翻译腔');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('拼音标识符会输出具体英文建议和行号', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', 'const shijian = Date.now();\nconst userName = shijian;\n');
  try {
    const report = runDoctor(dir);
    const finding = report.stats.pinyinFindings.find((item) => item.identifier === 'shijian');
    assert.deepStrictEqual(
      { suggestion: finding.suggestion, line: finding.line },
      { suggestion: 'time', line: 1 }
    );
    assert.ok(report.problems.some((p) => /shijian/.test(p.msg) && /time/.test(p.msg)), '未输出英文建议');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('包含原型属性名称的标识符不会导致 doctor 崩溃', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', 'const config = { shijian: 1 };\nconst constructorValue = config.constructor;\n');
  try {
    const report = runDoctor(dir);
    assert.ok(Array.isArray(report.stats.pinyinFindings));
    assert.ok(report.stats.pinyinFindings.some((item) => item.identifier === 'shijian'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('空目录（无任何文件）也能出报告不抛异常且得分低', () => {
  const dir = makeTemp();
  try {
    const report = runDoctor(dir);
    assert.ok(report.total < 30, `空目录应低分，实际 ${report.total}`);
    assert.strictEqual(report.level, 'danger');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isSeparatorDecoration 识别各类排版符号分隔线', () => {
  // 纯分隔线
  assert.ok(isSeparatorDecoration('===================='));
  assert.ok(isSeparatorDecoration('----------'));
  assert.ok(isSeparatorDecoration('········'));
  assert.ok(isSeparatorDecoration('━━━━━━━━━━'));
  // 装饰包裹 / 前后缀
  assert.ok(isSeparatorDecoration('=== 工具 ==='));
  assert.ok(isSeparatorDecoration('······ 工具 ······'));
  assert.ok(isSeparatorDecoration('==== 初始化逻辑'));
  assert.ok(isSeparatorDecoration('配置区结束 --------'));
  assert.ok(isSeparatorDecoration('——— 说明 ———'));
});

test('isSeparatorDecoration 不误伤正常注释', () => {
  assert.ok(!isSeparatorDecoration(''));
  assert.ok(!isSeparatorDecoration('工具函数：按金额汇总'));
  assert.ok(!isSeparatorDecoration('-*- coding: utf-8 -*-'));
  assert.ok(!isSeparatorDecoration('a - b = c，运算符说明'));
  assert.ok(!isSeparatorDecoration('重要：这里是 —— 转折'));
});

test('注释中的 ··· 装饰包裹会被 doctor 检出并扣分', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', '// ······ 工具 ······\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.stats.separatorCount, 1);
    assert.ok(report.problems.some((p) => p.key === 'comment' && /排版符号分隔线/.test(p.msg)), '未检出 ··· 装饰包裹');
    const commentCheck = report.checks.comment.find((c) => /分隔线/.test(c.title));
    assert.strictEqual(commentCheck.score, 0, '检出分隔线后该项不得分');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('现代 ESLint flat config（eslint.config.js）也被识别为 lint 配置', () => {
  const dir = makeTemp();
  // 仅放 eslint.config.js，不放任何旧式 .eslintrc*，验证现代配置不被漏判
  write(dir, 'eslint.config.js', 'export default [];\n');
  write(dir, 'README.md', '# demo\n\n一个演示项目。\n## 快速开始\n\nnpm install\n');
  try {
    const report = runDoctor(dir);
    const hygieneCheck = report.checks.hygiene.find((c) => /lint/.test(c.title));
    assert.strictEqual(hygieneCheck.score, 5, 'eslint.config.js 应计分 lint 配置');
    assert.ok(!report.problems.some((p) => p.key === 'hygiene' && /lint/.test(p.msg)), '现代配置不应报缺 lint');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('无任何 lint 配置（含现代 flat config）会扣分', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', 'function add(a, b) { return a + b; }\n');
  try {
    const report = runDoctor(dir);
    const hygieneCheck = report.checks.hygiene.find((c) => /lint/.test(c.title));
    assert.strictEqual(hygieneCheck.score, 0, '无 lint 配置应不得分');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('扩展名已覆盖 .css 等常见格式（.css/.vue/.html 被扫描）', () => {
  const dir = makeTemp();
  write(dir, 'src/style.css', '/* ······ 工具 ······ */\n.btn { color: red; }\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.stats.separatorCount, 1, '.css 注释中的 ······ 包裹应被检出');
    assert.ok(report.problems.some((p) => p.key === 'comment' && /style\.css/.test(p.file)), '应定位到 src/style.css');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('stylelint 配置被识别为 lint 配置（纯 CSS 项目不误判）', () => {
  const dir = makeTemp();
  write(dir, 'stylelint.config.js', 'export default {};\n');
  try {
    const report = runDoctor(dir);
    const hygieneCheck = report.checks.hygiene.find((c) => /lint/.test(c.title));
    assert.strictEqual(hygieneCheck.score, 5, 'stylelint.config.js 应计分 lint 配置');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('正常中文注释不会触发分隔线误报', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', '// 工具函数：按金额汇总\n// 公式：a - b = c\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.stats.separatorCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('忽略目录（.claude/.workbuddy 等）内的文件不被检查', () => {
  const dir = makeTemp();
  // 把带排版符号污染的代码放进被忽略的 .claude 与 .workbuddy 目录
  write(dir, '.claude/foo.js', '// ······ 工具 ······\nfunction a(){}\n');
  write(dir, '.workbuddy/bar.js', '/* ==== 过时注释 ==== */\nfunction b(){}\n');
  write(dir, 'src/clean.js', 'function c() { return 1; }\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.stats.separatorCount, 0, '忽略目录内的分隔线不应被计入');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('注释记录变更操作（修复/修改等）会被检出并扣分', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', '// 修复了空指针异常\n// 此处修改了逻辑\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.stats.commentChangeLogCount, 2);
    assert.ok(report.problems.some((p) => p.key === 'comment' && /变更操作/.test(p.msg)), '未检出变更操作注释');
    const changeLogCheck = report.checks.comment.find((c) => /变更操作/.test(c.title));
    assert.strictEqual(changeLogCheck.score, 0, '检出变更操作注释后该项不得分');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('注释里的版本号变更史（如 0.2.53：）会被检出', () => {
  const dir = makeTemp();
  write(dir, 'src/app.js', [
    '// 自绘目录面板 (0.2.46)：拦截站点目录按钮',
    '// 0.2.39→0.2.45 六轮修复 z 序',
    '// 0.2.53：不再轮询 document.body',
    'function add(a, b) { return a + b; }',
    'module.exports = { add };',
  ].join('\n') + '\n');
  try {
    const report = runDoctor(dir);
    assert.ok(report.stats.commentChangeLogCount >= 3, `版本史注释应被检出，实际 ${report.stats.commentChangeLogCount}`);
    assert.strictEqual(report.checks.comment.find((c) => /变更操作与版本史/.test(c.title)).score, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('单维度问题过多触发额外扣分，总分可为负并评定为非常危险', () => {
  const dir = makeTemp();
  // 命名维度：8 个拼音命名 + 缺 .gitignore → 违规 9 项，超出阈值(5)部分 = 3；
  // 代码卫生：6 处 console.log + 6 处 TODO + 6 行死代码 → 超出部分 = 1+1+1 = 3；
  // 合计额外扣分 = 6（未触顶），baseTotal 已被压到 0，因此总分 = -6 < 0 → 非常危险
  write(dir, 'src/app.js', [
    'const jine = 1;', 'const shijian = 2;', 'const mingcheng = 3;', 'const leixing = 4;',
    'const xinxi = 5;', 'const zhuangtai = 6;', 'const bianhao = 7;', 'const dizhi = 8;',
    'const a = 0;', 'const b = 0;',
    'console.log(a + b);', 'console.log(a + b);', 'console.log(a + b);',
    'console.log(a + b);', 'console.log(a + b);', 'console.log(a + b);',
    '// ······ 工具 ······', '// 修复了空指针异常', '// 通过对数据进行一个排序的操作',
    '// if (x) return;', '// if (y) return;', '// if (z) return;',
    '// if (a) return;', '// if (b) return;', '// if (c) return;',
    '// TODO: x', '// TODO: y', '// TODO: z', '// TODO: w', '// TODO: u', '// TODO: v',
  ].join('\n') + '\n');
  try {
    const report = runDoctor(dir);
    assert.strictEqual(report.extraPenalty, 6, '命名超 3 + 卫生超 3 = 应额外扣 6');
    assert.ok(report.total < 0, `总分应可为负，实际 ${report.total}`);
    assert.strictEqual(report.level, 'veryDanger');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('注释卫生多得分点违规时各点独立触顶 -10（合计 -20）', () => {
  const dir = makeTemp();
  // 50 行排版分隔线 + 90 行"修复了…"版本变更史注释：两个得分点各自远超阈值，
  // 每个点超出部分按单点上限 -10 截断 → 合计额外扣分 = -20（而非全局只 -10）
  const lines = [];
  for (let i = 0; i < 50; i++) lines.push('// ----- 分隔 ' + i + ' -----');
  for (let i = 0; i < 90; i++) lines.push('// 修复了第 ' + i + ' 处问题');
  write(dir, 'src/app.js', lines.join('\n') + '\n');
  // 其余维度尽量满分（readme/license/claude.md/gitignore/lint 齐全），排除 baseTotal 干扰
  write(dir, 'README.md', '# App\n\n快速开始：npm test\n');
  write(dir, 'LICENSE', 'MIT\n');
  write(dir, 'CLAUDE.md', 'npm test\n');
  write(dir, '.gitignore', 'node_modules\n');
  write(dir, '.eslintrc.json', '{}\n');
  try {
    const report = runDoctor(dir);
    assert.ok(report.stats.separatorCount >= 50, `分隔线应被检出，实际 ${report.stats.separatorCount}`);
    assert.ok(report.stats.commentChangeLogCount >= 90, `变更史应被检出，实际 ${report.stats.commentChangeLogCount}`);
    const sepCheck = report.checks.comment.find((c) => /排版符号/.test(c.title));
    const changeCheck = report.checks.comment.find((c) => /变更操作与版本史/.test(c.title));
    assert.strictEqual(sepCheck.extra, 10, '排版分隔线得分点应额外扣 10');
    assert.strictEqual(changeCheck.extra, 10, '变更史得分点应额外扣 10');
    assert.strictEqual(report.extraPenalty, 20, '两个注释得分点各 -10，合计应额外扣 20');
    assert.strictEqual(report.total, report.baseTotal - 20, '总分 = 基础分 - 20');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('待修复按严重程度排序：触发额外扣分(超标)的项目排最前', () => {
  const dir = makeTemp();
  // 只制造两类问题，排除其它维度干扰：
  // 1) 缺 CHANGELOG（doc，基础分 2，无超标）→ 权重低
  // 2) 6 行排版分隔线（comment，>5 超标，触发额外扣分）→ 权重最高
  write(dir, 'README.md', '# App\n\n快速开始：npm test\n');
  write(dir, 'LICENSE', 'MIT\n');
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push('// ----- 分隔 ' + i + ' -----');
  write(dir, 'src/app.js', lines.join('\n') + '\n');
  try {
    const report = runDoctor(dir);
    const ranked = [...report.problems].sort((a, b) => b.weight - a.weight);
    assert.strictEqual(ranked[0].key, 'comment', '超标(额外扣分)项目应排最前');
    assert.ok(/排版符号分隔线/.test(ranked[0].msg), '排第一的应是排版分隔线问题');
    assert.ok(ranked[0].weight >= 1000, '超标项目权重应 ≥ 1000');
    assert.ok(ranked[0].weight > ranked[ranked.length - 1].weight, '首位权重应大于末位');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
