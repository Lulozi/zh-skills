/**
 * init 模块测试：多工具规则入口的幂等生成。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeAgentRuleFiles } = require('../src/init');

test('writeAgentRuleFiles 生成 VS Code Copilot 和 Cursor 规则且幂等', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-skills-init-'));
  try {
    const first = writeAgentRuleFiles(dir);
    assert.strictEqual(first.created.length, 2);
    assert.strictEqual(first.skipped.length, 0);
    assert.match(
      fs.readFileSync(path.join(dir, '.github', 'copilot-instructions.md'), 'utf8'),
      /AGENTS\.md/
    );
    assert.match(
      fs.readFileSync(path.join(dir, '.cursor', 'rules', 'zh-skills.mdc'), 'utf8'),
      /alwaysApply: true/
    );

    const second = writeAgentRuleFiles(dir);
    assert.strictEqual(second.created.length, 0);
    assert.strictEqual(second.skipped.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
