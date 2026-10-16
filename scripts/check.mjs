// בדיקות לפונקציות הטקסט של התוסף. הרצה: node scripts/check.mjs (נדרש Node 23.6 ומעלה, שקורא TypeScript).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { englishInReply, firstEnglish, isEnglishLabel, rtlMarks, shownTexts, workflowTexts, RLM } from '../hooks/hebrew.ts'
import { rules } from '../hooks/rules.ts'

const field = input => firstEnglish(shownTexts(input))?.field ?? null

test('תיאור באנגלית נתפס, גם במילה אחת, ובעברית עובר', () => {
  assert.equal(isEnglishLabel('description', 'List files in current directory'), true)
  assert.equal(isEnglishLabel('description', 'git status'), true)
  assert.equal(isEnglishLabel('description', 'Build'), true)
  assert.equal(isEnglishLabel('description', 'הצגת הקבצים בתיקייה'), false)
  assert.equal(isEnglishLabel('description', 'הרצת npm test על התוסף'), false)
  assert.equal(isEnglishLabel('header', 'Approach'), true)
  assert.equal(isEnglishLabel('header', 'API'), false)
})

test('בשדה של שם: שמות של מוצרים עוברים, משפטים נתפסים', () => {
  assert.equal(isEnglishLabel('label', 'React Native'), false)
  assert.equal(isEnglishLabel('label', 'Claude Code Desktop'), false)
  assert.equal(isEnglishLabel('label', 'Yes'), false)
  assert.equal(isEnglishLabel('label', 'Yes, fix it now'), true)
  assert.equal(isEnglishLabel('label', 'Use Redis cache'), true)
  assert.equal(isEnglishLabel('label', 'Do It Here'), true)
  assert.equal(isEnglishLabel('label', 'כן, לתקן'), false)
})

test('קוד, נתיבים ומזהים לא נספרים כאנגלית', () => {
  assert.equal(isEnglishLabel('description', '`npm run build`'), false)
  assert.equal(isEnglishLabel('description', 'C:/Users/dev/file.ts src/app.tsx'), false)
  assert.equal(isEnglishLabel('description', 'stage.py BILLING_MODEL'), false)
})

test('קריאה לכלי: השדה הראשון באנגלית מזוהה', () => {
  assert.equal(field({ tool: 'Bash', command: 'ls -la', description: 'List all files' }), 'description')
  assert.equal(field({ tool: 'Bash', command: 'ls', description: 'הצגת הקבצים' }), null)
  assert.equal(field({ tool: 'Read', file_path: 'C:/x.ts' }), null)
  assert.equal(
    field({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'לבדוק', status: 'done' }, { content: 'Write the tests now', status: 'pending' }] }),
    'content',
  )
  assert.equal(
    field({ tool: 'mcp__ccd_turn__wrap_up', recap: 'התוסף מוכן ונבדק.', actions: [{ action: 'commit' }, { label: 'כן, לפרסם' }] }),
    null,
  )
})

test('רשימת המשימות של הטרמינל נבדקת: TodoWrite, ‏TaskCreate, ‏TaskUpdate', () => {
  assert.equal(field({ tool: 'TodoWrite', todos: [{ content: 'Write the unit tests', status: 'pending', activeForm: 'כותב בדיקות' }] }), 'content')
  assert.equal(field({ tool: 'TodoWrite', todos: [{ content: 'לכתוב בדיקות', status: 'pending', activeForm: 'Writing tests' }] }), 'activeForm')
  assert.equal(field({ tool: 'TaskCreate', subject: 'Write the unit tests', description: 'בדיקות לפרסר' }), 'subject')
  assert.equal(field({ tool: 'TaskUpdate', taskId: '1', status: 'completed' }), null)
})

test('הודעות, התראות והסברים בכלי מחשב נבדקים', () => {
  assert.equal(field({ tool: 'SendUserMessage', message: 'סיימתי. השגיאה הייתה "Cannot read properties of undefined" ותוקנה.' }), null)
  assert.equal(field({ tool: 'SendUserMessage', message: 'Done, I fixed the parser and all the tests pass now.' }), 'message')
  assert.equal(field({ tool: 'PushNotification', message: 'Build finished', status: 'proactive' }), 'message')
  assert.equal(field({ tool: 'ScheduleWakeup', delaySeconds: 600, reason: 'watching CI run' }), 'reason')
  assert.equal(field({ tool: 'mcp__computer-use__computer_batch', actions: [{ action: 'left_click', action_summary: 'Opens the settings menu' }] }), 'action_summary')
  assert.equal(field({ tool: 'mcp__computer-use__teach_step', explanation: 'This is the settings menu', next_preview: 'הבא: אלחץ', actions: [] }), 'explanation')
  assert.equal(field({ tool: 'mcp__computer-use__request_access', apps: ['Notepad'], reason: 'לפתוח את הקובץ' }), null)
  assert.equal(field({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: 'y', action_summary: 'Something else' }), null)
})

test('workflow: התיאור, שמות השלבים והתוויות נבדקים; טקסט בתוך prompt או schema לא', () => {
  const script = [
    "export const meta = { name: 'scan', description: 'Find flaky tests and fix them', phases: [{ title: 'סריקה' }] }",
    "const SCHEMA = { type: 'object', properties: { title: { type: 'string', description: 'The short title of the bug' } } }",
    "await agent(`Report as {label: 'Review the bugs now'} and call log('some english text')`, { label: 'סוכן: בדיקה', schema: SCHEMA })",
    "await agent(p, { label: `review:${d.key}` })",
    "$.log('Not the workflow log at all')",
  ].join('\n')

  assert.deepEqual(workflowTexts(script).map(one => one.field), ['meta.description', 'meta.title', 'label', 'label'])
  assert.equal(firstEnglish(workflowTexts(script))?.field, 'meta.description')

  const hebrew = script.replace('Find flaky tests and fix them', 'איתור בדיקות לא יציבות ותיקונן')
  assert.equal(firstEnglish(workflowTexts(hebrew)), null)
})

test('workflow: גרש בהערה בתוך meta לא מבטל את הבדיקה', () => {
  const script = "export const meta = {\n  // don't touch the name\n  name: 'x',\n  description: 'Run the full review now',\n}\n"
  assert.equal(firstEnglish(workflowTexts(script))?.field, 'meta.description')
})

test('תשובה בעברית עוברת, ותשובה באנגלית נתפסת גם כשהמשפטים קצרים', () => {
  assert.equal(englishInReply('הכל עובד. הקובץ `src/index.ts` עודכן והבדיקות עברו.'), null)
  assert.notEqual(englishInReply('הכל עובד. Now I will run the tests and check the output again.'), null)
  assert.notEqual(englishInReply('All done. Tests pass now.'), null)
  assert.equal(englishInReply('OK'), null)
})

test('בדיקת התשובה מתעלמת מקוד, ציטוטים וטבלאות', () => {
  assert.equal(englishInReply('הפקודה:\n```\nnpm install and then run the build script for production\n```'), null)
  assert.equal(englishInReply('הפקודה:\n~~~\nnpm install and then run the build script for production\n~~~'), null)
  assert.equal(englishInReply('הפלט:\n```\nnpm install and then run the build script for production'), null)
  assert.equal(englishInReply('השגיאה הייתה "Cannot read properties of undefined reading map" ותיקנתי.'), null)
  assert.equal(englishInReply('הטיוטה:\n> Hi John, thanks for the quick reply and see you tomorrow.\nתגיד אם לשנות.'), null)

  const table = '| שם | סוג |\n|---|---|\n| Redis | Cache store |\n| Postgres | Relational database |\n| SQLite | Embedded file database |\n| MongoDB | Document database store |'
  assert.equal(englishInReply(`השוואה קצרה:\n${table}`), null)
})

test('סימוני כיווניות: אחרי סימן הרשימה, הכותרת, הציטוט וההדגשה, ולא בתוך קוד', () => {
  const input = [
    '## כותרת',
    '- `file.ts` עודכן.',
    '1. שלב ראשון',
    '> ציטוט',
    'plain english line',
    '```',
    'const x = "שלום"',
    '```',
    '| עמודה | value |',
    '|---|---|',
  ].join('\n')
  const out = rtlMarks(input).split('\n')
  assert.equal(out[0], `## ${RLM}כותרת`)
  assert.equal(out[1], `- ${RLM}\`file.ts\` עודכן.${RLM}`)
  assert.equal(out[2], `1. ${RLM}שלב ראשון`)
  assert.equal(out[3], `> ${RLM}ציטוט`)
  assert.equal(out[4], 'plain english line')
  assert.equal(out[6], 'const x = "שלום"')
  assert.equal(out[8], `| ${RLM}עמודה | value |`)
  assert.equal(out[9], '|---|---|')
})

test('סימוני כיווניות: ההדגשה נשמרת, ובלוקים מקוננים מקבלים את הסימון במקום הנכון', () => {
  assert.equal(rtlMarks('**`a.ts`** עודכן'), `**${RLM}\`a.ts\`** עודכן`)
  assert.equal(rtlMarks('- **מודגש.**'), `- **${RLM}מודגש.**`)
  assert.equal(rtlMarks('~~`old`~~ הוסר'), `~~${RLM}\`old\`~~ הוסר`)
  assert.equal(rtlMarks('- > ציטוט ברשימה'), `- > ${RLM}ציטוט ברשימה`)
  assert.equal(rtlMarks('1. [ ] משימה'), `1. [ ] ${RLM}משימה`)
  assert.equal(rtlMarks('- - פריט מקונן'), `- - ${RLM}פריט מקונן`)
  assert.equal(rtlMarks('| **שם** | ערך |'), `| **${RLM}שם** | ${RLM}ערך |`)
})

test('סימוני כיווניות: קוד בתוך רשימה, קוד מוזח והגדרות קישורים לא משתנים', () => {
  const nested = '- פריט:\n  ```\n  const x = "שלום"\n  ```\n- עוד פריט'
  const lines = rtlMarks(nested).split('\n')
  assert.equal(lines[2], '  const x = "שלום"')
  assert.equal(lines[4], `- ${RLM}עוד פריט`)

  assert.equal(rtlMarks('פסקה\n\n    const x = "שלום"').split('\n')[2], '    const x = "שלום"')
  assert.equal(rtlMarks('- פריט ראשון\n\n    המשך מוזח').split('\n')[2], `    ${RLM}המשך מוזח`)

  assert.equal(rtlMarks('[ref]: https://example.com "כותרת"'), '[ref]: https://example.com "כותרת"')
  assert.equal(rtlMarks('[^1]: הערה'), `[^1]: ${RLM}הערה`)

  const quoted = '> ```\n> קוד בציטוט\n> ```'
  assert.equal(rtlMarks(quoted), quoted)
})

test('סימוני כיווניות: הרצה שנייה לא מוסיפה עוד סימנים, וטקסט בלי עברית לא משתנה', () => {
  const once = rtlMarks('שורה ראשונה.\n**שורה** שנייה\n- `x` שלישית')
  assert.equal(rtlMarks(once), once)
  assert.equal(rtlMarks('only english here'), 'only english here')
})

test('ההנחיות משתנות לפי ההגדרה של הערות בקוד', () => {
  assert.match(rules('match'), /המשך באנגלית/)
  assert.match(rules('hebrew'), /תמיד בעברית/)
  assert.match(rules('english'), /תמיד באנגלית/)
})

test('הגרסה הידנית לא מזכירה את התוסף, ו-HEBREW.md מעודכן', () => {
  assert.match(rules('match'), /hebrew-rtl/)
  assert.doesNotMatch(rules('match', true), /תוסף/)
  const file = readFileSync(new URL('../HEBREW.md', import.meta.url), 'utf8')
  assert.equal(file, `${rules('match', true)}\n`, 'הרץ node scripts/build-rules.mjs')
})
