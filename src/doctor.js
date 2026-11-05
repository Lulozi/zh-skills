/**
 * `zh-skills doctor`：对项目做"中文工程健康体检"（静态启发式检查）。
 *
 * 检查维度与 skills/health-check-zh 对齐，共 100 分：
 *   A. 文档健康  25 分 —— README 定位、快速开始、翻译腔、LICENSE/CHANGELOG
 *   B. AI 协作   15 分 —— CLAUDE.md/AGENTS.md、skills/rules、命令说明
 *   C. 命名健康  20 分 —— 拼音命名、命名风格
 *   D. 代码卫生  20 分 —— console.log、TODO 残留、死代码、lint 配置
 *   E. 注释卫生  20 分 —— 排版符号分隔线污染、翻译腔注释
 *
 * 纯启发式、无副作用、可离线运行。报告对象与打印分离，便于测试。
 */

const fs = require('node:fs');
const path = require('node:path');

/** 常见拼音标识符到英文的映射（保持零依赖，避免把英文词典误判为拼音） */
const PINYIN_MAP = Object.freeze({
  'jine': 'amount', 'shijian': 'time', 'mingcheng': 'name', 'leixing': 'type',
  'xinxi': 'info', 'zhuangtai': 'status', 'bianhao': 'id', 'dizhi': 'address',
  'shuju': 'data', 'liebiao': 'list', 'xiangmu': 'project', 'wenti': 'issue',
  'jieguo': 'result', 'fangfa': 'method', 'canshu': 'parameter', 'yanzheng': 'validate',
  'zhuce': 'register', 'denglu': 'login', 'tuijian': 'recommend', 'guanli': 'manage',
  'tongji': 'stats', 'baocun': 'save', 'shanchu': 'remove', 'xinzeng': 'add',
  'xiugai': 'update', 'chaxun': 'query', 'bianliang': 'variable', 'ziduan': 'field',
  'yonghu': 'user', 'shangpin': 'product', 'dingdan': 'order', 'wenjian': 'file',
  'mulu': 'directory', 'kongzhi': 'control', 'chuli': 'process', 'fuwu': 'service',
  'yingyong': 'application', 'biao': 'table', 'mima': 'password', 'zhanghu': 'account',
  'quanxian': 'permission', 'shezhi': 'config',
});

const PINYIN_WORDS = Object.keys(PINYIN_MAP);

/** 翻译腔句式（出现在中文文档中判为"机翻痕迹"） */
const TRANSLATIONESE = [
  '进行一个', '通过使用', '需要注意的是', '我们可以', '该工具是',
  '被用于', '这将会', '需要确保', '请确保', '为了能够', '综上所述',
];

/**
 * 排版符号字符集：注释里连续重复 3 次以上即判为装饰性分隔线。
 * 覆盖 ASCII（= - ~ _ *）、间隔号变体（· • ‧ ・）、制表/全角（─ ━ — – ＝ ＊ ～）与星标（★ ☆）。
 */
const SEPARATOR_CHARS = '=\\-~_*·•‧・─━—–＝＊～★☆';
const SEPARATOR_RUN_RE = new RegExp(`([${SEPARATOR_CHARS}])\\1{2,}`);
const PURE_SEPARATOR_RE = new RegExp(`^[${SEPARATOR_CHARS}\\s]+$`);
const LEADING_SEPARATOR_RE = new RegExp(`^([${SEPARATOR_CHARS}])\\1{2,}\\s*\\S`);
const TRAILING_SEPARATOR_RE = new RegExp(`\\S\\s*([${SEPARATOR_CHARS}])\\1{2,}$`);

/**
 * 判断注释正文是否为排版符号污染：纯分隔线（`===`），
 * 或用重复符号做装饰包裹/前后缀（`··· 工具 ···`、`==== 初始化`）。
 */
function isSeparatorDecoration(commentBody) {
  const body = commentBody.trim();
  if (!body) return false;
  if (PURE_SEPARATOR_RE.test(body)) return SEPARATOR_RUN_RE.test(body);
  return LEADING_SEPARATOR_RE.test(body) || TRAILING_SEPARATOR_RE.test(body);
}

/** 需要扫描的代码文件扩展名 */
// 需要扫描的代码文件扩展名（覆盖主流后端、前端、样式与标记语言）
const CODE_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.java', '.go', '.rs', '.rb', '.php', '.c', '.cpp', '.h',
  '.css', '.scss', '.less', '.vue', '.svelte', '.astro', '.html', '.htm',
]);

/** 需要跳过的目录 */
// 跳过依赖/产物/测试目录：测试夹具常故意构造坏样本，不应计入业务代码健康度；
// 同时跳过 AI / IDE / 工具生成的目录，它们与业务代码无关，检查它们只会产生噪音
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'coverage', '.next', '.nuxt', 'vendor', '__pycache__',
  'test', 'tests', '__tests__', 'spec', 'e2e',
  // AI / 工具 / IDE 生成的目录（不检查其内容）
  '.workbuddy', '.github', '.agents', '.claude', '.gemini', '.cursor', '.idea', '.vscode', '.codebuddy', '.augment', '.cline',
]);

const LEVELS = [
  { min: 90, key: 'excellent', label: '🟢 优秀', note: '可以直接当团队样板' },
  { min: 70, key: 'good', label: '🟡 良好', note: '有零星问题，修一下更好' },
  { min: 50, key: 'fair', label: '🟠 一般', note: '中文规范基本没落地' },
  { min: 0, key: 'danger', label: '🔴 危险', note: 'AI 都读不懂，先补文档' },
  { min: -Infinity, key: 'veryDanger', label: '⚫ 非常危险', note: '规范严重缺失且问题大量堆积，优先治理' },
];

function levelOf(score) {
  return LEVELS.find((l) => score >= l.min) || LEVELS[LEVELS.length - 1];
}

/** 触发额外扣分的违规数量阈值（超过即"超标"，权重最高） */
const EXTRA_PENALTY_THRESHOLD = 5;

/**
 * 待修复项严重程度权重：触发额外扣分（超标）的项目最高，其余按"基础失分 × 维度"定级。
 * - 超标项：+1000，确保所有额外扣分问题排在最前；
 * - 基础分：子项本身失分（如缺 README=10、缺 LICENSE=3），失分越多越严重；
 * - 维度：命名/文档/注释 略高于 AI 协作/代码卫生，作为同级失分时的次级排序。
 * @param {string} key 维度
 * @param {number} basePoints 该问题对应的基础失分（满分值）
 * @param {number} count 该问题对应的实际违规数量（用于判断是否超标）
 */
function severityRank(key, basePoints, count) {
  const extra = count > EXTRA_PENALTY_THRESHOLD ? 1000 : 0;
  const dimRank = { name: 4, doc: 3, comment: 3, ai: 2, hygiene: 1 }[key] || 1;
  return extra + basePoints * 10 + dimRank;
}

/** 递归收集目标目录下的代码文件（带数量上限） */
function collectCodeFiles(dir, limit = 300) {
  const out = [];
  const walk = (d) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(d, e.name));
      } else if (CODE_EXT.has(path.extname(e.name))) {
        out.push(path.join(d, e.name));
      }
    }
  };
  walk(dir);
  return out;
}

/** 读取文件前 N 字符（防止读入巨型文件/二进制） */
function safeRead(file, maxBytes = 256 * 1024) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) return '';
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** 用空格遮住注释和字符串，保留换行以便返回准确行号 */
function maskNonCode(text) {
  return text
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (value) => value.replace(/[^\n]/g, ' '))
    .replace(/(^|[\r\n])\s*#[^\r\n]*/g, (value) => value.replace(/[^\r\n]/g, ' '));
}

/** 把 camelCase/snake_case 标识符拆成可翻译的词段 */
function splitIdentifier(identifier) {
  return identifier
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .split(/[_$]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

/** 扫描代码标识符并给出英文建议 */
function findPinyinIdentifiers(text) {
  const masked = maskNonCode(text);
  const lines = text.split('\n');
  const findings = [];
  const identifierRegex = /[A-Za-z_$][A-Za-z0-9_$]*/g;
  let match;
  while ((match = identifierRegex.exec(masked))) {
    const identifier = match[0];
    const parts = splitIdentifier(identifier);
    const hasPinyinPart = parts.some((part) => Object.prototype.hasOwnProperty.call(PINYIN_MAP, part));
    if (!hasPinyinPart) continue;
    const suggestionParts = parts.map((part) =>
      Object.prototype.hasOwnProperty.call(PINYIN_MAP, part) ? PINYIN_MAP[part] : part
    );
    const suggestion = suggestionParts
      .map((part, index) => (index === 0 ? part : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
      .join('');
    const line = masked.slice(0, match.index).split('\n').length;
    if (suggestion.toLowerCase() === identifier.toLowerCase()) continue;
    if (!findings.some((item) => item.identifier === identifier && item.line === line)) {
      findings.push({ identifier, suggestion, line, text: lines[line - 1].trim() });
    }
  }
  return findings;
}

/**
 * 运行体检，返回报告对象（纯数据，便于测试与复用）。
 * @param {string} targetDir
 */
function runDoctor(targetDir) {
  const checks = [];
  const problems = [];

  const rootExists = (name) => fs.existsSync(path.join(targetDir, name));

  // A. 文档健康（25 分）
  const docChecks = [];
  const readmePath = ['README.md', 'README.MD', 'readme.md', 'README.rst', 'README.txt'].map((n) => path.join(targetDir, n)).find((p) => fs.existsSync(p));
  let readmeText = '';
  if (readmePath) readmeText = safeRead(readmePath);

  const hasReadme = Boolean(readmePath);
  const hasQuickstart = /(快速开始|快速上手|快速启动|安装|Getting Started|Quick Start|Installation|Usage)/i.test(readmeText);
  const isChineseDoc = (readmeText.match(/[一-鿿]/g) || []).length > 5;
  const translationese = [];
  if (isChineseDoc) {
    // 跳过代码块（```）与块引用（>）——示例/引用常含翻译腔演示词，属正常引用
    const prose = readmeText
      .replace(/```[\s\S]*?```/g, '')
      .split('\n')
      .filter((l) => !/^\s*>/.test(l))
      .join('\n');
    for (const phrase of TRANSLATIONESE) {
      if (prose.includes(phrase)) translationese.push(phrase);
    }
  }
  const hasLicense = rootExists('LICENSE') || rootExists('LICENSE.md') || rootExists('LICENSE.txt') || rootExists('LICENCE');
  const hasChangelog = /CHANGELOG/i.test(fs.readdirSync(targetDir).join(' '));

  // "无翻译腔"仅在 README 存在时计分，空目录不给分
  const noTranslationeseScore = hasReadme && translationese.length === 0 ? 5 : 0;

  if (!hasReadme) problems.push({ key: 'doc', file: 'README.md', msg: '缺少 README，读者和 AI 都无从入手', weight: severityRank('doc', 10, hasReadme ? 0 : 1) });
  if (hasReadme && !hasQuickstart) problems.push({ key: 'doc', file: 'README.md', msg: '缺少快速开始章节，无法照着跑起来', weight: severityRank('doc', 5, hasReadme && !hasQuickstart ? 1 : 0) });
  for (const phrase of translationese) problems.push({ key: 'doc', file: 'README.md', msg: `翻译腔句式「${phrase}」，建议改写成地道中文`, weight: severityRank('doc', 5, translationese.length) });
  if (!hasLicense) problems.push({ key: 'doc', file: 'LICENSE', msg: '缺少 LICENSE', weight: severityRank('doc', 3, hasLicense ? 0 : 1) });
  if (!hasChangelog) problems.push({ key: 'doc', file: 'CHANGELOG.md', msg: '缺少 CHANGELOG（建议配 Conventional Commits 自动生成）', weight: severityRank('doc', 2, hasChangelog ? 0 : 1) });

  // 合并「README 存在且有定位」：有 README 且首段有实质内容 = 10 分
  const readmeContentScore = hasReadme && /\S/.test(readmeText.replace(/#.*$/gm, '')) ? 10 : (hasReadme ? 5 : 0);
  docChecks.push(
    { title: 'README 存在且首段有实质定位', score: readmeContentScore, max: 10 },
    { title: 'README 有快速开始', score: hasQuickstart ? 5 : 0, max: 5 },
    { title: '文档无翻译腔', score: noTranslationeseScore, max: 5 },
    { title: '有 LICENSE / CHANGELOG', score: (hasLicense ? 3 : 0) + (hasChangelog ? 2 : 0), max: 5 },
  );

  // B. AI 协作（15 分）
  const hasClaudeMd = rootExists('CLAUDE.md') || rootExists('AGENTS.md');
  // 优先读 CLAUDE.md（更详细），其次 AGENTS.md
  const agentFilePath = ['CLAUDE.md', 'AGENTS.md'].map((n) => path.join(targetDir, n)).find((p) => fs.existsSync(p));
  const claudeText = agentFilePath ? safeRead(agentFilePath) : '';
  const hasSkillDirs = rootExists(path.join('.claude', 'skills')) || rootExists(path.join('.cursor', 'rules')) || rootExists('.cursorrules');
  const hasCommands = /(npm (test|run|build)|yarn (test|run|build)|pnpm (test|run|build)|python .*(test|pytest)|go (test|build)|cargo (test|build)|mix test|make (test|build))/i.test(claudeText);

  if (!hasClaudeMd) problems.push({ key: 'ai', file: 'CLAUDE.md', msg: '缺少 CLAUDE.md/AGENTS.md，AI 不了解项目约定（可用 `zh-skills init` 生成）', weight: severityRank('ai', 5, hasClaudeMd ? 0 : 1) });
  if (!hasSkillDirs) problems.push({ key: 'ai', file: '.claude/skills', msg: '未安装工程规范技能（可用 `zh-skills init` 一键安装）', weight: severityRank('ai', 5, hasSkillDirs ? 0 : 1) });
  if (hasClaudeMd && !hasCommands) problems.push({ key: 'ai', file: 'CLAUDE.md', msg: 'CLAUDE.md 未写明常用命令，AI 不知道该跑什么', weight: severityRank('ai', 5, hasClaudeMd && !hasCommands ? 1 : 0) });

  const aiChecks = [
    { title: '有 CLAUDE.md / AGENTS.md', score: hasClaudeMd ? 5 : 0, max: 5 },
    { title: '有工程规范技能 / 规则', score: hasSkillDirs ? 5 : 0, max: 5 },
    { title: 'CLAUDE.md 写清了命令', score: hasCommands ? 5 : 0, max: 5 },
  ];

  // C. 命名健康（20 分）
  const codeFiles = collectCodeFiles(targetDir);
  const pinyinHits = [];
  const pinyinFindings = [];
  let fileCount = 0;
  for (const file of codeFiles) {
    fileCount++;
    const text = safeRead(file);
    const findings = findPinyinIdentifiers(text);
    if (findings.length) {
      const relativeFile = path.relative(targetDir, file);
      pinyinHits.push({ file: relativeFile, lines: findings.map((item) => item.line) });
      findings.forEach((item) => pinyinFindings.push({ file: relativeFile, ...item }));
    }
  }
  // 无代码文件时无法评估命名，不给满分
  const pinyinScore = pinyinHits.length ? 0 : codeFiles.length ? 10 : 0;
  for (const finding of pinyinFindings.slice(0, 8)) {
    problems.push({
      key: 'name',
      file: `${finding.file}:${finding.line}`,
      msg: `疑似拼音命名「${finding.identifier}」，建议改成「${finding.suggestion}」`,
      weight: severityRank('name', 10, pinyinFindings.length),
    });
  }
  if (pinyinFindings.length > 8) {
    problems.push({ key: 'name', file: '(更多)', msg: `另有 ${pinyinFindings.length - 8} 处疑似拼音命名，可用 health-check-zh 技能逐一处理`, weight: severityRank('name', 10, pinyinFindings.length) });
  }

  const nameChecks = [
    { title: '代码中无拼音命名', score: pinyinScore, max: 10 },
    { title: '有 .gitignore（命名之外的仓库卫生）', score: rootExists('.gitignore') ? 10 : 0, max: 10 },
  ];
  if (!rootExists('.gitignore')) problems.push({ key: 'name', file: '.gitignore', msg: '缺少 .gitignore', weight: severityRank('name', 10, rootExists('.gitignore') ? 0 : 1) });

  // D. 代码卫生（20 分）
  let consoleLogCount = 0;
  let todoCount = 0;
  let commentedCodeLines = 0;
  for (const file of codeFiles) {
    const text = safeRead(file);
    // console.log 统计：排除"输出常量"（render 调用 / 纯标识符 / 属性 / 字符串字面量），
    // 只统计疑似调试残留（参数是表达式/模板变量的调用）
    const logLines = text
      .split('\n')
      .filter((l) => /console\.log\(/.test(l) && !/render\./.test(l))
      .filter((l) => !/console\.log\(\s*(?:[a-zA-Z_$][\w$.]*|"[^"]*"|'[^']*')\s*\)/.test(l)).length;
    consoleLogCount += logLines;
    // TODO 统计：要求后跟 : 或 (，避免把词表声明/正则自身当残留
    todoCount += (text.match(/\b(TODO|FIXME|HACK)\s*[:(]/g) || []).length;
    // 启发式：被注释掉且带常见代码特征的连续行
    const commented = text.split('\n').filter((l) => /^\s*(\/\/|#|--|\/\*|\*)\s*(if |for |const |let |function|return |import |from )/.test(l)).length;
    commentedCodeLines += commented;
  }
  if (consoleLogCount > 5) problems.push({ key: 'hygiene', file: 'src', msg: `检测到 ${consoleLogCount} 处 console.log，建议清理或改为正式日志`, weight: severityRank('hygiene', 5, consoleLogCount) });
  if (todoCount > 5) problems.push({ key: 'hygiene', file: 'src', msg: `检测到 ${todoCount} 处 TODO/FIXME，建议建立待办清单跟踪`, weight: severityRank('hygiene', 5, todoCount) });
  if (commentedCodeLines > 5) problems.push({ key: 'hygiene', file: 'src', msg: `检测到 ${commentedCodeLines} 行被注释的死代码`, weight: severityRank('hygiene', 5, commentedCodeLines) });

  // fs.existsSync 不支持通配符，必须枚举具体文件名
  // 同时识别旧式（.eslintrc* / .prettierrc*）与现代 flat config（eslint.config.* / prettier.config.*）
  const lintFiles = [
    '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs',
    'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
    '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs',
    'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs',
    'stylelint.config.js', 'stylelint.config.mjs', 'stylelint.config.cjs',
    '.stylelintrc', '.stylelintrc.json', '.stylelintrc.js', '.stylelintrc.cjs',
    'biome.json', 'biome.jsonc', '.golangci.yml', '.rubocop.yml',
  ];
  const hasLint = lintFiles.some((f) => rootExists(f));

  const hygieneChecks = [
    { title: `console.log 残留 ≤ 5（当前 ${consoleLogCount}）`, score: consoleLogCount <= 5 ? 5 : 0, max: 5 },
    { title: `TODO/FIXME 残留 ≤ 5（当前 ${todoCount}）`, score: todoCount <= 5 ? 5 : 0, max: 5 },
    { title: `无整段注释死代码（当前 ${commentedCodeLines} 行）`, score: commentedCodeLines <= 5 ? 5 : 0, max: 5 },
    { title: '有 lint/format 配置', score: hasLint ? 5 : 0, max: 5 },
  ];

  // E. 注释卫生（20 分）
  // 检测注释中的排版符号污染（===、---、··· 等重复符号分隔线）、翻译腔，以及"记录变更操作"的注释
  let separatorCount = 0;
  let commentTranslationeseCount = 0;
  let commentChangeLogCount = 0;
  const separatorFiles = [];
  const commentTranslationeseFiles = [];
  const changeLogFiles = [];
  // 注释中的翻译腔句式（与文档翻译腔共用词表，但只检测注释内容）
  const COMMENT_TRANSLATIONESE = ['进行一个', '通过使用', '需要注意的是', '被用于', '这将会', '为了能够'];
  // 注释里"把历史变更写进注释"的写法：此类信息应写在提交历史，注释只描述功能与意图
  // 1) 动作词（修复/修改等，含已完成的"了"/"："）
  const COMMENT_CHANGE_OP = [
    '修复了', '修复：', '修复bug',
    '修改了', '修改：', '此处修改', '上次修改', '本次修改', '改动', '本次改动',
    '调整了', '调整：',
    '重构了', '重构：',
    '删除了', '删掉', '去掉了',
    '更新了', '更新：',
    'fix:', 'fixed bug', 'fixed the', 'fixed an', 'hotfix', 'bugfix',
    'changed:', 'refactor:', 'update:', 'updated the', 'updated:',
  ];
  // 2) 版本标记 + 冒号/箭头模式，识别"把各版本变更写进注释"式写法
  const VERSION_HISTORY_RE = /\bv?\d+\.\d+(?:\.\d+)?\s*[)）]?\s*[：:→]/;
  const VERSION_HISTORY_RE2 = /\bv\d+\.\d+(?:\.\d+)?\b/i;
  const VERSION_HISTORY_RE3 = /(?:版本号|变更史)/;
  function isChangeLogComment(body) {
    const lowered = body.toLowerCase();
    if (COMMENT_CHANGE_OP.some((phrase) => lowered.includes(phrase))) return true;
    if (VERSION_HISTORY_RE.test(body)) return true;
    if (VERSION_HISTORY_RE2.test(lowered)) return true;
    if (VERSION_HISTORY_RE3.test(lowered)) return true;
    return false;
  }
  for (const file of codeFiles) {
    const text = safeRead(file);
    const lines = text.split('\n');
    const relFile = path.relative(targetDir, file);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // 只检测单行注释正文（//、#、--、/*、* 开头）
      const commentMatch = line.match(/^\s*(?:\/\/|#|--|\/\*|\*)\s*(.*)/);
      if (!commentMatch) continue;
      const commentBody = commentMatch[1];
      // 排版符号污染：纯分隔线或 `··· 标题 ···` 式装饰包裹
      if (isSeparatorDecoration(commentBody)) {
        separatorCount++;
        if (!separatorFiles.includes(relFile)) separatorFiles.push(relFile);
      }
      // 检测注释中的翻译腔句式
      for (const phrase of COMMENT_TRANSLATIONESE) {
        if (commentBody.includes(phrase)) {
          commentTranslationeseCount++;
          if (!commentTranslationeseFiles.includes(relFile)) commentTranslationeseFiles.push(relFile);
        }
      }
      // 检测"把历史变更写进注释"的写法（修复/修改等动作，或版本标记记录），这类应进提交历史
      if (isChangeLogComment(commentBody)) {
        commentChangeLogCount++;
        if (!changeLogFiles.includes(relFile)) changeLogFiles.push(relFile);
      }
    }
  }
  if (separatorCount > 0) {
    problems.push({
      key: 'comment',
      file: separatorFiles.slice(0, 3).join(', '),
      msg: `注释中检测到 ${separatorCount} 处排版符号分隔线（===、---、··· 等），会污染渲染，改用准确标题或自然语言说明`,
      weight: severityRank('comment', 10, separatorCount),
    });
  }
  if (commentTranslationeseCount > 0) {
    problems.push({
      key: 'comment',
      file: commentTranslationeseFiles.slice(0, 3).join(', '),
      msg: `注释中检测到 ${commentTranslationeseCount} 处翻译腔句式，建议改成地道中文`,
      weight: severityRank('comment', 5, commentTranslationeseCount),
    });
  }
  if (commentChangeLogCount > 0) {
    problems.push({
      key: 'comment',
      file: changeLogFiles.slice(0, 3).join(', '),
      msg: `注释中检测到 ${commentChangeLogCount} 处变更操作 / 版本史记录（修复、修改、版本号等），这类历史应写在提交日志，而非注释`,
      weight: severityRank('comment', 5, commentChangeLogCount),
    });
  }
  // 无代码文件时无法评估注释，不给满分
  const separatorScore = codeFiles.length ? (separatorCount === 0 ? 10 : 0) : 0;
  const commentToneScore = codeFiles.length ? (commentTranslationeseCount === 0 ? 5 : 0) : 0;
  const commentChangeLogScore = codeFiles.length ? (commentChangeLogCount === 0 ? 5 : 0) : 0;
  const commentChecks = [
    { title: `注释无排版符号分隔线污染（当前 ${separatorCount} 处）`, score: separatorScore, max: 10 },
    { title: `注释无翻译腔 / 废话注释（当前 ${commentTranslationeseCount} 处）`, score: commentToneScore, max: 5 },
    { title: `注释不记录变更操作与版本史（当前 ${commentChangeLogCount} 处）`, score: commentChangeLogScore, max: 5 },
  ];

  // 按组结构化返回，打印时按固定顺序渲染（避免扁平数组切分错位）
  const grouped = { doc: docChecks, ai: aiChecks, name: nameChecks, hygiene: hygieneChecks, comment: commentChecks };
  const baseTotal = Object.values(grouped).flat().reduce((sum, c) => sum + c.score, 0);

  // 额外扣分：基于"各得分点（sub-check）的实际违规数量"而非去重后的问题条数；
  // 任一得分点的实际违规数 > 阈值(5) 时，超出部分每项 -1，**每个得分点独立封顶 -10**，
  // 各点累加（无全局封顶），确保"问题大量堆积"会被显著惩罚，且总分允许为负（低于 0 即"非常危险"）
  const EXTRA_PENALTY_CAP = 10;
  const violationCounts = [
    // A. 文档健康
    hasReadme ? 0 : 1,
    hasReadme && !hasQuickstart ? 1 : 0,
    translationese.length,
    (hasLicense ? 0 : 1) + (hasChangelog ? 0 : 1),
    // B. AI 协作
    hasClaudeMd ? 0 : 1,
    hasSkillDirs ? 0 : 1,
    hasClaudeMd && !hasCommands ? 1 : 0,
    // C. 命名健康
    pinyinFindings.length,
    rootExists('.gitignore') ? 0 : 1,
    // D. 代码卫生
    consoleLogCount,
    todoCount,
    commentedCodeLines,
    hasLint ? 0 : 1,
    // E. 注释卫生
    separatorCount,
    commentTranslationeseCount,
    commentChangeLogCount,
  ];
  let extraPenalty = 0;
  // 把每个得分点的"额外扣分"挂到对应 check 上（check 顺序与 violationCounts 一一对应），
  // 便于报告在对应行尾逐行标注；各点独立封顶后累加
  const allChecks = [...docChecks, ...aiChecks, ...nameChecks, ...hygieneChecks, ...commentChecks];
  allChecks.forEach((c, i) => {
    const count = violationCounts[i] || 0;
    const extra = count > EXTRA_PENALTY_THRESHOLD ? Math.min(count - EXTRA_PENALTY_THRESHOLD, EXTRA_PENALTY_CAP) : 0;
    c.extra = extra;
    extraPenalty += extra;
  });
  const total = baseTotal - extraPenalty;
  const level = levelOf(total);

  return {
    targetDir,
    total,
    max: 100,
    baseTotal,
    extraPenalty,
    level: level.key,
    levelLabel: level.label,
    levelNote: level.note,
    checks: grouped,
    problems,
    stats: {
      codeFiles: fileCount,
      pinyinFindings,
      consoleLogCount,
      todoCount,
      separatorCount,
      commentTranslationeseCount,
      commentChangeLogCount,
    },
  };
}

/** 打印报告（纯展示，无副作用） */
function printReport(report) {
  const render = require('./render');
  console.log(render.title('🏥 zh-skills · 中文工程健康体检'));
  console.log(`${render.bold(`总分：${report.total}/100`)}  ${render.bold(report.levelLabel)}  ${render.gray(report.levelNote)}`);
  console.log(render.line());

  // 按固定顺序渲染分组
  const groups = [
    { key: 'doc', label: '文档健康' },
    { key: 'ai', label: 'AI 协作' },
    { key: 'name', label: '命名健康' },
    { key: 'hygiene', label: '代码卫生' },
    { key: 'comment', label: '注释卫生' },
  ];

  // 所有得分点标题的显示宽度，用于把"扣分"对齐到同一列（CJK/全角按 2 宽计算）
  const titleColWidth = Object.values(report.checks).flat()
    .reduce((w, c) => Math.max(w, render.displayWidth(c.title)), 0);

  for (const g of groups) {
    const items = report.checks[g.key] || [];
    if (!items.length) continue;
    const sub = items.reduce((s, c) => s + c.score, 0);
    const subMax = items.reduce((s, c) => s + c.max, 0);
    const letter = { doc: 'A', ai: 'B', name: 'C', hygiene: 'D', comment: 'E' }[g.key];
    console.log(`${render.bold(`${letter}. ${g.label}`)}  ${render.gray(`${sub}/${subMax}`)}`);
    for (const c of items) {
      const mark = c.score >= c.max ? render.green('✔') : render.yellow('·');
      const baseDeduction = c.score < c.max ? `-${c.max - c.score}` : '';
      const hasDeduction = Boolean(baseDeduction) || c.extra > 0;
      if (!hasDeduction) {
        console.log(`  ${mark} ${c.title}`);
        continue;
      }
      // 基础扣分（红）固定占 3 宽右对齐；额外扣分（黄，与汇总行"额外扣分"同色）紧随其后并整体对齐到同一列；
      // 标题与 `·` 引导符之间留一个空格，避免文字与引导符贴死
      const gap = titleColWidth - render.displayWidth(c.title);
      const leader = gap > 0 ? '·'.repeat(gap) : '';
      const baseField = baseDeduction.padEnd(3, ' ');
      const extraField = c.extra > 0 ? `  ${render.yellow('额外')}${render.red(` -${c.extra}`)}` : '';
      const titlePart = `${c.title} ${leader}`;
      console.log(`  ${mark} ${titlePart} ${render.red(baseField)}${extraField}`);
    }
  }

  if (report.problems.length) {
    console.log(render.line());
    if (report.extraPenalty > 0) {
      console.log(`${render.yellow('额外扣分：')}${render.red(`-${report.extraPenalty}`)}`);
      console.log(`${render.yellow('总 扣 分：')}${render.red(`-${report.max - report.total}`)}`);
    }
    console.log(render.bold('⚠ 待修复（按严重程度排序）'));
    // 按严重程度权重降序排：触发额外扣分的排最前，其余按基础失分与维度定级
    const ranked = [...report.problems].sort((a, b) => b.weight - a.weight);
    ranked.slice(0, 12).forEach((p, idx) => {
      console.log(`  ${idx + 1}. [${p.key}] ${p.file}: ${p.msg}`);
    });
  } else {
    console.log(render.line());
    console.log(render.ok('没有发现问题，中文工程规范执行得不错！'));
  }

  console.log(render.line());
  console.log(render.info('修复建议：`zh-skills init` 一键安装规范技能，再逐项按清单修复。'));
}

module.exports = { runDoctor, printReport, PINYIN_WORDS, PINYIN_MAP, findPinyinIdentifiers, TRANSLATIONESE, isSeparatorDecoration };
