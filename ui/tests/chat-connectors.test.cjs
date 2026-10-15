const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createI18n } = require('vue-i18n');

for (const locale of ['en', 'tr']) {
  test(`${locale} chat connector instructions render mentions and provider names`, async () => {
    const messages = (await import(`../src/locales/${locale}.ts`)).default;
    const { t } = createI18n({ legacy: false, locale, messages: { [locale]: messages } }).global;
    const instructions = t('chatgptConnector.instructions');
    assert.ok(instructions.includes('@'));
    assert.ok(instructions.includes('DCR'));
    assert.ok(!instructions.includes("{'@'}"));
    for (const app of ['ChatGPT', 'Claude']) {
      for (const key of ['chatPromptCopied', 'chatPromptReady', 'chatPromptLabel', 'chatPromptHint', 'openChatApp']) {
        const rendered = t(`calendarPlan.${key}`, { app });
        assert.ok(rendered.includes(app), `${key} should name ${app}`);
        assert.ok(!rendered.includes('{app}'));
      }
    }
  });
}
