import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

import type { HebrewMode } from '../types'
import { englishInReply, firstEnglish, rtlMarks, shownTexts } from './hebrew'
import {
  DESCRIBE_NOTE,
  PAUSED_NOTE,
  RESUMED_NOTE,
  TOOL_REMINDER,
  TURN_REMINDER,
  denyReason,
  rules,
  stopReason,
} from './rules'
import type { CodeComments } from './rules'

const mode = atom({ plugin: 'hebrew-rtl', key: 'mode' } as const, 'on' as HebrewMode)

/** כל כמה הודעות ההנחיות המלאות מצורפות שוב להודעה, למקרה שהן לא הגיעו או נדחסו. */
const REFRESH_EVERY = 10

/** כלים שהתיאור שלהם מוצג למשתמש: אליהם נוספת הערה שהתיאור נכתב בעברית. */
const DESCRIBED = new Set(['Bash', 'PowerShell', 'Agent', 'Monitor', 'Workflow'])

/** בקשה מפורשת לאנגלית או לתרגום: בתור כזה לא בודקים אנגלית בסוף. */
const ASKS_ENGLISH = /אנגלית|תרגם|תרגמ|תרגום|english|translat/i

/** פלט של כלי שיש בו לפחות כך הרבה אותיות לטיניות (ויותר מעבריות) מקבל תזכורת אחריו. */
const LATIN_OUTPUT = 200

/** הודעות של סוכנים אחרים: לא מקבלות את התזכורת הקצרה. */
const AGENT_ORIGIN = /^(?:peer|observer)/

/** האורך שהמשטח מצייר; הודעה שהסימונים יאריכו מעבר לו נשארת כמו שהיא, כדי שלא תיחתך. */
const MAX_DRAWN = 100_000

async function isOn($: EngineInterface): Promise<boolean> {
  try {
    return (await read($, mode)) !== 'off'
  } catch {
    return true
  }
}

/** התור האחרון: ההודעה שפתחה אותו, וכל מה שהעוזר כתב בו למשתמש (כולל SendUserMessage). */
function lastTurn(messages: readonly SessionMessage[]): { prompt: string; replies: string[] } {
  const replies: string[] = []

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]

    if (message === undefined) {
      continue
    }

    if (message.role === 'user') {
      // שורת user בלי תוצאות של כלים פותחת תור, גם כשאין בה טקסט (תמונה בלבד).
      if ((message.toolResults ?? []).length === 0) {
        return { prompt: message.text, replies }
      }

      continue
    }

    const sent = message.toolUses
      .filter(use => use.tool === 'SendUserMessage')
      .map(use => String(use.input.message ?? ''))

    replies.unshift(message.text, ...sent)
  }

  return { prompt: '', replies }
}

function latinHeavy(text: string | undefined): boolean {
  if (text === undefined) {
    return false
  }

  const latin = (text.match(/[A-Za-z]/g) ?? []).length

  return latin >= LATIN_OUTPUT && latin > (text.match(/[֐-׿]/g) ?? []).length
}

export const register: Register = (on, options) => {
  const enforce = options.enforce !== false
  const stopCheck = options.stopCheck !== false
  const reminders = options.reminders !== false
  const rtlDisplay = options.rtlDisplay !== false
  const comments: CodeComments =
    options.codeComments === 'hebrew' || options.codeComments === 'english' ? options.codeComments : 'match'
  const section = rules(comments)

  let submits = 0

  // חסימות שכבר נשלחו: אותו טקסט באותו שדה נחסם פעם אחת בלבד, כדי שלא תיווצר לולאה.
  const denied = new Set<string>()

  // ההנחיות המלאות נכנסות ל-system prompt של הסשן, תמיד, גם במצב מושהה: שינוי של ה-system
  // prompt באמצע סשן כותב מחדש את כל המטמון. ההשהיה מגיעה למודל כהודעה (ראו ‎/hebrew‎).
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      ...composed,
      sections: [...composed.sections, { id: 'hebrew-rtl:rules', text: section, scope: 'session' as const }],
    }
  })

  // ליד כל הודעה: ההנחיות המלאות בהודעה הראשונה אחרי טעינה ואחר כך כל עשר הודעות, ותזכורת קצרה
  // בשאר. כך ההנחיות מגיעות גם כש-prompt.compose לא רץ (ארגון מנוהל, אפליקציית desktop, טעינה באמצע שיחה).
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined || !(await isOn($))) {
      return next(e)
    }

    const isRefresh = submits % REFRESH_EVERY === 0
    submits += 1
    const text = isRefresh
      ? section
      : reminders && !AGENT_ORIGIN.test(e.origin.kind)
        ? TURN_REMINDER
        : null

    return text === null ? next(e) : next({ ...e, context: [...(e.context ?? []), text] })
  })

  // סוכני משנה לא מקבלים את הסעיף של prompt.compose: ההנחיות מגיעות אליהם כהקשר בתחילת הריצה.
  on('classic.SubagentStart', async ($, e, next) => {
    const result = await next(e)

    if (!(await isOn($))) {
      return result
    }

    return { ...result, additionalContext: [...(result.additionalContext ?? []), section] }
  })

  // הערה בתיאור של הכלים שהתיאור שלהם מוצג למשתמש. רץ גם בארגון מנוהל, ונשמר במטמון של הפרומפט.
  on('tool.describe', async ($, e, next) => {
    const described = await next(e)

    return enforce && DESCRIBED.has(e.tool)
      ? { ...described, description: `${described.description}\n\n${DESCRIBE_NOTE}` }
      : described
  })

  // לפני כלי: טקסט שמוצג למשתמש וכתוב באנגלית עוצר את הקריאה, פעם אחת לכל טקסט.
  // אחרי כלי: פלט ארוך באנגלית מקבל תזכורת קצרה, כי זה הרגע שבו המודל נוטה לעבור לאנגלית.
  // בלי ‎.catch‎: אם הבדיקה עצמה נכשלת, הקריאה ממשיכה כרגיל.
  on('tool.call', async ($, e, next) => {
    if (!(await isOn($))) {
      return next(e)
    }

    if (enforce) {
      let input = e as unknown as Readonly<Record<string, unknown>>

      if (input.tool === 'Workflow' && typeof input.script !== 'string' && typeof input.scriptPath === 'string') {
        const script = await $.fs.read(input.scriptPath).catch(() => null)
        input = script === null ? input : { ...input, script }
      }

      const english = firstEnglish(shownTexts(input))

      if (english !== null) {
        const key = `${english.field}\u0000${english.sample}`

        if (!denied.has(key)) {
          if (denied.size > 200) {
            denied.clear()
          }

          denied.add(key)

          return { deny: denyReason(english.field, english.sample) }
        }
      }
    }

    const ran = await next(e)

    if (!reminders || ran.deny !== undefined || !latinHeavy(ran.text)) {
      return ran
    }

    return { ...ran, context: [...(ran.context ?? []), TOOL_REMINDER] }
  })

  // בסוף התור: אם נכתבו למשתמש משפטים באנגלית, בקשה אחת לכתוב אותם מחדש בעברית.
  // לא בתור שבו המשתמש ביקש אנגלית או תרגום.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)

    if (!stopCheck || e.stop_hook_active || result.block !== undefined || !(await isOn($))) {
      return result
    }

    let turn = { prompt: '', replies: [e.last_assistant_message ?? ''] }

    try {
      const found = lastTurn(await $.session.messages())

      if (found.replies.length > 0) {
        turn = found
      }
    } catch {
      // נשארים עם ההודעה האחרונה בלבד
    }

    if (ASKS_ENGLISH.test(turn.prompt)) {
      return result
    }

    for (const reply of turn.replies) {
      const sample = englishInReply(reply)

      if (sample !== null) {
        return { ...result, block: stopReason(sample) }
      }
    }

    return result
  })

  // תצוגה: סימוני כיווניות בשורות בעברית. רק הציור משתנה, לא ההודעה השמורה.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    const text = rtlDisplay ? rtlMarks(e.props.text) : e.props.text

    return text === e.props.text || text.length > MAX_DRAWN ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    const text = rtlDisplay ? rtlMarks(e.props.text) : e.props.text

    return text === e.props.text || text.length > MAX_DRAWN ? next(e) : next({ ...e, props: { ...e.props, text } })
  })

  // ‎/hebrew‎: מצב, הפעלה או השהיה של האכיפה בסשן הנוכחי.
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'hebrew',
        description: 'מצב העברית בסשן הזה: on מפעיל, off משהה, בלי מילה מציג את המצב',
        argumentHint: '[on|off]',
        immediate: true,
      })
      .catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'hebrew' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const before = await read($, mode)

    if (word === 'on' || word === 'off') {
      await update($, mode, () => word)
    }

    const now = await read($, mode)
    const text =
      now === 'off'
        ? 'מצב העברית מושהה בסשן הזה: אין חסימות, אין תזכורות ואין בדיקה בסוף התור. כדי להפעיל שוב: ‎/hebrew on‎'
        : 'מצב העברית פעיל: הנחיות מלאות, תזכורות, חסימת תיאורים באנגלית ובדיקה בסוף התור. כדי להשהות: ‎/hebrew off‎'

    if (now === before) {
      return { text }
    }

    return { text, context: [now === 'off' ? PAUSED_NOTE : RESUMED_NOTE] }
  })
}
