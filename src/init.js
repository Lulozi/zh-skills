/**
 * `zh-skills init`：把中文工程规范技能装进目标项目。
 *
 * 顺带解决两个真实痛点：
 * 1. 装 skills —— 让 Claude Code 遵守中文工程规范。
 * 2. 生成通用 agent 引导文件 —— 让不同 AI 工具共享同一份项目约定。
 */

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const render = require('./render');
const { listSkills, installSkills } = require('./skills');

/** 通用 CLAUDE.md 模板（中文工程导向） */
const CLAUDE_MD_TEMPLATE = `# CLAUDE.md

> 本项目使用 zh-skills 中文工程规范。此文件是给 AI 协作伙伴看的"项目说明书"，请按实际项目补充。

## 项目是什么
<!-- 一句话：这个项目解决什么问题，用什么技术栈 -->

## 常用命令
\`\`\`
# 安装依赖
npm install

# 本地开发
npm run dev

# 测试
npm test

# 构建
npm run build
\`\`\`

## 工程约定
- 变量/函数用英文命名，注释用中文（详见 .claude/skills/ 中的规范）。
- commit message 遵循 Conventional Commits，中文描述（见 commit-zh）。
- 修改公共 API 或破坏性变更，必须在 commit 正文标注 BREAKING CHANGE。

## 目录结构
<!-- 简述 src/ 等关键目录职责，帮助 AI 快速定位 -->

## 需要注意
<!-- 踩过的坑、特殊的边界情况、不要动的地方 -->
`;

/**
 * 交互式提问。
 * @returns {Promise<string|null>} 答案或 null（非 TTY / 用户输入为空）
 */
function ask(question, defaultValue = '') {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(null);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim() || defaultValue || null);
    });
  });
}

/** 生成 CLAUDE.md（已存在则跳过） */
function writeClaudeMd(targetDir, force = false) {
  const file = path.join(targetDir, 'CLAUDE.md');
  if (fs.existsSync(file) && !force) return { file, skipped: true };
  fs.writeFileSync(file, CLAUDE_MD_TEMPLATE, 'utf8');
  return { file, skipped: false };
}

/** 生成 AGENTS.md（Codex、Cursor、WorkBuddy、DeepSeek Harness 等工具通用） */
function writeAgentsMd(targetDir) {
  const file = path.join(targetDir, 'AGENTS.md');
  if (fs.existsSync(file)) return { file, skipped: true };
  fs.writeFileSync(
    file,
    `# AGENTS.md

> 本文件供 Cursor / Codex / Devin 等 AI 工具阅读。
> 本项目使用 zh-skills 中文工程规范，详细规范见 .claude/skills/ 下的 SKILL.md。
> 请遵循：英文命名、中文注释、Conventional Commits 中文描述。
`,
    'utf8'
  );
  return { file, skipped: false };
}

/** 生成遵循各工具约定的规则入口，不覆盖用户已有配置 */
function writeAgentRuleFiles(targetDir) {
  const files = [
    {
      file: path.join(targetDir, '.github', 'copilot-instructions.md'),
      content: `# Copilot Instructions

本项目使用 zh-skills 中文工程规范。请遵循：变量和函数使用英文命名，注释使用中文，提交信息使用 Conventional Commits 中文描述。
详细规则见项目根目录的 AGENTS.md 与 \`.claude/skills/\`。
`,
    },
    {
      file: path.join(targetDir, '.cursor', 'rules', 'zh-skills.mdc'),
      content: `---
description: 中文工程规范
alwaysApply: true
---

请遵循项目根目录 AGENTS.md 中的中文工程规范，并参考 .claude/skills/ 下的具体技能。
`,
    },
  ];
  const result = { created: [], skipped: [] };
  for (const item of files) {
    if (fs.existsSync(item.file)) {
      result.skipped.push(item.file);
      continue;
    }
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    fs.writeFileSync(item.file, item.content, 'utf8');
    result.created.push(item.file);
  }
  return result;
}

/**
 * init 主流程。
 * @param {object} opts
 * @param {string} opts.dir 目标项目目录（默认当前目录）
 * @param {boolean} opts.yes 非交互，全部默认执行
 */
async function runInit(opts) {
  const targetDir = path.resolve(opts.dir || process.cwd());

  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    render.err(`目录不存在：${targetDir}`);
    process.exitCode = 1;
    return;
  }

  render.title('zh-skills · 安装中文工程规范');

  // 1. 安装 skills
  const result = installSkills(targetDir);
  result.installed.forEach((n) => console.log(render.ok(`${n} 已安装`)));
  result.skipped.forEach((n) => console.log(render.info(`${n} 已存在，跳过`)));
  result.errors.forEach((n) => console.log(render.warn(n)));

  if (!result.installed.length && !result.skipped.length) {
    render.err('没有安装任何技能，请检查 skills 目录。');
    return;
  }

  const installedPath = path.join(targetDir, '.claude', 'skills');
  console.log(render.line());
  console.log(render.info(`技能目录：${installedPath}`));
  console.log(render.info('下次打开 Claude Code 会自动加载这些技能。'));

  // 2. 生成 CLAUDE.md（默认生成）
  const wantClaude = opts.yes || (await ask('是否生成 CLAUDE.md 引导文件？[Y/n] ', 'y'));
  if (wantClaude === 'y' || wantClaude === 'Y' || wantClaude === true) {
    const claude = writeClaudeMd(targetDir);
    if (claude.skipped) console.log(render.info('CLAUDE.md 已存在，保留原文件'));
    else console.log(render.ok('已生成 CLAUDE.md'));
  }

  // 3. 生成 AGENTS.md（Codex、Cursor、WorkBuddy、DeepSeek Harness 等也能读到规范）
  const wantAgents = opts.yes || (await ask('是否同步生成 AGENTS.md（供 Cursor/Codex 阅读）？[Y/n] ', 'y'));
  if (wantAgents === 'y' || wantAgents === 'Y' || wantAgents === true) {
    const agents = writeAgentsMd(targetDir);
    if (agents.skipped) console.log(render.info('AGENTS.md 已存在，保留原文件'));
    else console.log(render.ok('已生成 AGENTS.md'));
  }

  // 4. 生成 VS Code Copilot / Cursor 的原生规则入口
  const ruleFiles = writeAgentRuleFiles(targetDir);
  ruleFiles.created.forEach((file) => console.log(render.ok(`已生成 ${path.relative(targetDir, file)}`)));
  ruleFiles.skipped.forEach((file) => console.log(render.info(`${path.relative(targetDir, file)} 已存在，保留原文件`)));

  console.log(render.line());
  console.log(render.ok('安装完成。Claude Code、Codex、Cursor、VS Code Copilot 等 AI 工具都可读取中文规范。'));
}

module.exports = { runInit, CLAUDE_MD_TEMPLATE, writeClaudeMd, writeAgentsMd, writeAgentRuleFiles };
