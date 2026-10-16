// זיהוי אנגלית בטקסט שמוצג למשתמש, והוספת סימוני כיווניות לתצוגה.

export const RLM = '‏'

const HEBREW = /[֐-׿]/
const HEBREW_ALL = /[֐-׿]/g
const LATIN_ALL = /[A-Za-z]/g
const WORD_ALL = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g

// ---------------------------------------------------------------- מבנה markdown

/** קידומות של בלוקים מכילים: ציטוט, סימן רשימה ותיבת משימה, בכל סדר ובכל עומק. */
const CONTAINERS = /^\s*(?:>\s*|(?:[-*+]|\d{1,9}[.)])(?:\s+|$)(?:\[[ xX]\]\s+)?)*/
const ITEM = /(?:^|[\s>])(?:[-*+]|\d{1,9}[.)])(?:\s|$)/
const FENCE = /^(`{3,}|~{3,})(.*)$/

function containerPrefix(line: string): string {
  return CONTAINERS.exec(line)?.[0] ?? ''
}

/**
 * לכל שורה: האם היא קוד. בלוק מגודר (``` או ~~~, גם בתוך ציטוט או רשימה, גם בלי סגירה)
 * נסגר רק ברצף מאותו תו, באורך שווה או ארוך יותר ובלי טקסט אחריו. שורה מוזחת ב-4 רווחים
 * היא קוד רק מחוץ לרשימה ואחרי שורה ריקה; בתוך רשימה היא המשך של הפריט.
 */
function codeMask(lines: readonly string[]): boolean[] {
  const mask: boolean[] = []
  let fence: { mark: string; size: number } | null = null
  let isInList = false
  let isPrevBlank = true
  let isPrevIndentedCode = false

  for (const line of lines) {
    const prefix = containerPrefix(line)
    const opener = FENCE.exec(line.slice(prefix.length))

    if (fence !== null) {
      const run = opener?.[1] ?? ''

      if (opener !== null && run[0] === fence.mark && run.length >= fence.size && (opener[2] ?? '').trim() === '') {
        fence = null
      }

      mask.push(true)
      continue
    }

    if (opener !== null) {
      const run = opener[1] ?? '```'
      fence = { mark: run[0] ?? '`', size: run.length }
      mask.push(true)
      isPrevBlank = false
      continue
    }

    if (line.trim() === '') {
      mask.push(isPrevIndentedCode)
      isPrevBlank = true
      continue
    }

    if (ITEM.test(prefix)) {
      isInList = true
    } else if (!/^\s/.test(line) && !prefix.includes('>')) {
      isInList = false
    }

    const isIndentedCode: boolean =
      !isInList && prefix.trim() === '' && /^(?: {4,}|\t)/.test(line) && (isPrevBlank || isPrevIndentedCode)

    mask.push(isIndentedCode)
    isPrevIndentedCode = isIndentedCode
    isPrevBlank = false
  }

  return mask
}

// ---------------------------------------------------------------- זיהוי אנגלית

/**
 * הפרוזה שבטקסט: בלי קוד (בלוקים ו-inline), ציטוטים (שורות > ומירכאות בלי עברית),
 * קישורים, נתיבים, כתובות ומזהים. מה שנשאר הוא מה שהעוזר כתב במילים שלו.
 */
export function prose(text: string): string {
  const lines = text.split('\n')
  const mask = codeMask(lines)

  return lines
    .filter((_, i) => mask[i] !== true)
    .join('\n')
    .replace(/(`+)[\s\S]*?\1/g, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/"[^"\n֐-׿]*"|“[^”\n֐-׿]*”|«[^»\n֐-׿]*»/g, ' ')
    .replace(/!?\[[^\]\n]*\]\([^)\n]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\S+@\S+/g, ' ')
    .replace(/\S*[/\\]\S*/g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/\b\w*[\d_.=:]\w*\b/g, ' ')
    .replace(/\b[a-z]+[A-Z][A-Za-z]*\b/g, ' ')
    .replace(/\b[A-Z][a-z]+[A-Z][A-Za-z]*\b/g, ' ')
}

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length
}

function clip(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()

  return one.length > 100 ? `${one.slice(0, 100)}…` : one
}

/** מילים באנגלית, בלי ראשי תיבות (API, CSS, RTL), שהם שמות ולא שפה. */
function englishWords(plain: string): string[] {
  return (plain.match(WORD_ALL) ?? []).filter(word => word !== word.toUpperCase())
}

/** רצף של 6 מילים באנגלית ומעלה: משפט אמיתי, לא שם של מוצר או כפתור. */
function englishRun(text: string): string | null {
  const run = /(?:\b[A-Za-z][A-Za-z'’-]*\b[\s,;:()-]+){5,}\b[A-Za-z][A-Za-z'’-]*\b/.exec(text)

  return run === null ? null : run[0]
}

/** הקטע הלטיני הארוך ביותר בטקסט: הדוגמה שמוצגת למודל. */
function longestLatin(text: string): string {
  const parts = text.match(/[A-Za-z][A-Za-z\s,;:'’()-]*[A-Za-z]/g) ?? []

  return parts.reduce((best, part) => (part.length > best.length ? part : best), '')
}

/**
 * הודעה אחת שהעוזר כתב: דוגמה מהאנגלית שבה, או null כשהיא בעברית. אנגלית היא משפט של
 * 6 מילים ומעלה, הודעה בלי אף אות עברית עם 3 מילים באנגלית ומעלה, או רוב של אותיות
 * לטיניות (בלי שורות של טבלה, שבהן תאים הם לרוב שמות וערכים).
 */
export function englishInReply(text: string): string | null {
  const plain = prose(text)
  const run = englishRun(plain)

  if (run !== null) {
    return clip(run)
  }

  if (!HEBREW.test(plain) && englishWords(plain).length >= 3) {
    return clip(plain)
  }

  const body = plain.replace(/^\s*\|.*$/gm, ' ')
  const latin = count(body, LATIN_ALL)

  return latin >= 60 && latin > count(body, HEBREW_ALL) ? clip(longestLatin(body)) : null
}

/** שדות שהם שם (תווית, כותרת, שם של שלב) מול שדות שהם משפט (תיאור, סיכום, שאלה). */
const NAME_FIELDS = new Set(['label', 'title', 'phase()'])

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'with', 'and', 'or', 'but', 'from', 'by', 'as', 'at', 'if',
  'is', 'are', 'be', 'it', 'this', 'that', 'these', 'now', 'here', 'there', 'not', 'no', 'yes', 'do', 'does',
  'will', 'can', 'all', 'my', 'your', 'our', 'then', 'into', 'up', 'out', 'me', 'you', 'we', 'let', 'just',
])

/**
 * טקסט קצר שמוצג בממשק: באנגלית כשאין בו אף אות עברית ויש בו מילה באנגלית.
 * בשדה של שם, מילה אחת או צירוף באותיות גדולות בלי מילות קישור ("React Native") הוא שם ולא נחשב.
 */
export function isEnglishLabel(field: string, text: string): boolean {
  const plain = prose(text)

  if (HEBREW.test(plain)) {
    return false
  }

  const words = englishWords(plain)

  if (!NAME_FIELDS.has(field)) {
    return words.length >= 1
  }

  return (
    words.length >= 2 &&
    words.some(word => /^[a-z]/.test(word) || FUNCTION_WORDS.has(word.toLowerCase()))
  )
}

// ---------------------------------------------------------------- סקריפט של workflow

/** סריקת JavaScript: הקוד בלי הערות, וכל מחרוזת מוחלפת בסמן ‎\0מספר\0‎ שמצביע לתוכן שלה. */
function scanScript(src: string): { code: string; strings: string[] } {
  const strings: string[] = []
  let code = ''
  let i = 0

  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]

    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i)
      i = end < 0 ? src.length : end
    } else if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      code += ' '
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const [text, end] = readString(src, i)
      code += `\u0000${strings.length}\u0000`
      strings.push(text)
      i = end
    } else {
      code += ch
      i += 1
    }
  }

  return { code, strings }
}

/** מחרוזת שמתחילה ב-start: התוכן שלה (ביטויי ‎${}‎ מוחלפים ברווח) ואיפה היא נגמרת. */
function readString(src: string, start: number): [string, number] {
  const quote = src[start]
  let text = ''
  let i = start + 1

  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\') {
      const escaped = src[i + 1] ?? ''
      text += escaped === 'n' || escaped === 't' ? ' ' : escaped
      i += 2
    } else if (ch === quote) {
      return [text, i + 1]
    } else if (quote !== '`' && ch === '\n') {
      return [text, i]
    } else if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      i = skipExpression(src, i + 2)
      text += ' '
    } else {
      text += ch
      i += 1
    }
  }

  return [text, i]
}

function skipExpression(src: string, start: number): number {
  let depth = 1
  let i = start

  while (i < src.length && depth > 0) {
    const ch = src[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      i = readString(src, i)[1]
      continue
    }

    if (ch === '{') {
      depth += 1
    } else if (ch === '}') {
      depth -= 1
    }

    i += 1
  }

  return i
}

/** הבלוק ‎{...}‎ שאחרי ‎export const meta‎ בקוד שכבר בלי מחרוזות. */
function metaBlock(code: string): string {
  const start = code.search(/export\s+const\s+meta\b/)
  const open = start < 0 ? -1 : code.indexOf('{', start)

  if (open < 0) {
    return ''
  }

  let depth = 0

  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') {
      depth += 1
    } else if (code[i] === '}') {
      depth -= 1

      if (depth === 0) {
        return code.slice(open, i + 1)
      }
    }
  }

  return code.slice(open)
}

const META_KEYS = /\b(description|title|detail)\s*:\s*\u0000(\d+)\u0000/g
const LABELS = /\blabel\s*:\s*\u0000(\d+)\u0000/g
const CALLS = /(?<![.\w$])(phase|log)\(\s*\u0000(\d+)\u0000/g

/**
 * הטקסטים של workflow שמוצגים בממשק: התיאור ושמות השלבים ב-meta, התוויות של הסוכנים,
 * ושורות phase ו-log. רק מפתחות ששייכים לקוד עצמו נבדקים; טקסט בתוך prompt או schema לא.
 */
export function workflowTexts(script: string): Shown[] {
  const { code, strings } = scanScript(script)
  const out: Shown[] = []
  const text = (index: string | undefined): string => strings[Number(index)] ?? ''

  for (const [, key = '', index] of metaBlock(code).matchAll(META_KEYS)) {
    out.push({ field: `meta.${key}`, text: text(index) })
  }

  for (const [, index] of code.matchAll(LABELS)) {
    out.push({ field: 'label', text: text(index) })
  }

  for (const [, call = '', index] of code.matchAll(CALLS)) {
    out.push({ field: `${call}()`, text: text(index) })
  }

  return out
}

// ---------------------------------------------------------------- קריאות לכלים

/** טקסט שמוצג למשתמש. long: טקסט חופשי (הודעה) שנבדק כמו תשובה, ולא כמו תווית. */
export type Shown = { field: string; text: string; isLong?: boolean }

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    : []
}

/** כלים שמפעילים דפדפן או מחשב: שם ה-action_summary מוצג למשתמש. */
const ACTING = /^mcp__(?:remote-devices__)?(?:computer-use__|computer_|Claude_Browser__|claude-in-chrome__)/

/** כל action_summary בקלט, גם בתוך פעולות של batch. */
function summaries(value: unknown, depth: number, out: Shown[]): void {
  if (depth > 3 || typeof value !== 'object' || value === null) {
    return
  }

  for (const [key, inner] of Object.entries(value)) {
    const text = key === 'action_summary' ? str(inner) : null

    if (text !== null) {
      out.push({ field: 'action_summary', text })
    } else {
      summaries(inner, depth + 1, out)
    }
  }
}

/**
 * הטקסטים בקריאה לכלי שהממשק מציג למשתמש. כלים שלא ברשימה לא נבדקים.
 * ל-Workflow שמופעל מקובץ, הקורא מעביר את תוכן הקובץ ב-script.
 */
export function shownTexts(input: Readonly<Record<string, unknown>>): Shown[] {
  const tool = String(input.tool)
  const out: Shown[] = []
  const add = (field: string, value: unknown, isLong = false): void => {
    const text = str(value)

    if (text !== null) {
      out.push(isLong ? { field, text, isLong } : { field, text })
    }
  }

  switch (tool) {
    case 'Bash':
    case 'PowerShell':
    case 'Agent':
    case 'Monitor':
      add('description', input.description)
      break
    case 'Workflow': {
      const script = str(input.script)

      if (script !== null) {
        out.push(...workflowTexts(script))
      }

      break
    }
    case 'AskUserQuestion':
      for (const question of list(input.questions)) {
        add('question', question.question)
        add('header', question.header)

        for (const option of list(question.options)) {
          add('label', option.label)
          add('description', option.description)
        }
      }

      break
    case 'TodoWrite':
      for (const todo of list(input.todos)) {
        add('content', todo.content)
        add('activeForm', todo.activeForm)
      }

      break
    case 'TaskCreate':
    case 'TaskUpdate':
      add('subject', input.subject)
      add('activeForm', input.activeForm)
      add('description', input.description)
      break
    case 'SendUserMessage':
      add('message', input.message, true)
      break
    case 'PushNotification':
      add('message', input.message)
      break
    case 'ScheduleWakeup':
      add('reason', input.reason)
      break
    case 'SendUserFile':
      add('caption', input.caption)
      break
    case 'mcp__ccd_turn__update_plan':
      for (const item of list(input.items)) {
        add('content', item.content)
      }

      break
    case 'mcp__ccd_turn__wrap_up':
      add('recap', input.recap)
      add('ask', input.ask)

      for (const action of list(input.actions)) {
        if (action.action === undefined) {
          add('label', action.label)
          add('message', action.message)
        }
      }

      break
    case 'mcp__ccd_session__mark_chapter':
      add('title', input.title)
      add('summary', input.summary)
      break
    case 'mcp__ccd_session__start_session':
      add('title', input.title)
      break
    default:
      break
  }

  if (ACTING.test(tool)) {
    add('reason', input.reason)
    add('explanation', input.explanation)
    add('next_preview', input.next_preview)

    for (const step of list(input.steps)) {
      add('explanation', step.explanation)
      add('next_preview', step.next_preview)
    }

    summaries(input, 0, out)
  }

  return out
}

/** השדה הראשון שכתוב באנגלית, עם דוגמה ממנו; null כשהכל בעברית. */
export function firstEnglish(shown: readonly Shown[]): { field: string; sample: string } | null {
  for (const one of shown) {
    if (one.isLong === true) {
      const sample = englishInReply(one.text)

      if (sample !== null) {
        return { field: one.field, sample }
      }
    } else if (isEnglishLabel(one.field.replace(/^meta\./, ''), one.text)) {
      return { field: one.field, sample: clip(one.text) }
    }
  }

  return null
}

// ---------------------------------------------------------------- תצוגה

const HEADING = /^#{1,6}\s+/
const FOOTNOTE = /^\[\^[^\]\n]+\]:\s*/
const LINK_DEFINITION = /^\[[^\]\n]+\]:/
const MARKERS = /^[*_~]+/
const TRAILING = /[֐-׿][.,:;!?…]+$/

/** RLM לפני הטקסט, אחרי סימני הדגשה שפותחים אותו (אחרת ‎**‎ שאחריו פיסוק מפסיק להיות הדגשה). */
function mark(text: string, isEnd: boolean): string {
  const lead = /^\s*/.exec(text)?.[0] ?? ''
  let rest = text.slice(lead.length)
  const markers = MARKERS.exec(rest)?.[0] ?? ''
  rest = rest.slice(markers.length)

  if (!rest.startsWith(RLM)) {
    rest = `${RLM}${rest}`
  }

  if (isEnd && TRAILING.test(rest)) {
    rest = `${rest}${RLM}`
  }

  return `${lead}${markers}${rest}`
}

function markLine(line: string): string {
  let lead = containerPrefix(line)
  let rest = line.slice(lead.length)

  if (LINK_DEFINITION.test(rest) && !FOOTNOTE.test(rest)) {
    return line
  }

  for (const pattern of [HEADING, FOOTNOTE]) {
    const found = pattern.exec(rest)?.[0]

    if (found !== undefined) {
      lead += found
      rest = rest.slice(found.length)
    }
  }

  if (rest.startsWith('|')) {
    const cells = rest.split(/(?<!\\)\|/)

    return `${lead}${cells.map(cell => (HEBREW.test(cell) ? mark(cell, false) : cell)).join('|')}`
  }

  return `${lead}${mark(rest, true)}`
}

/**
 * מוסיף RLM בתחילת כל שורה שיש בה עברית (אחרי סימני הרשימה, הכותרת, הציטוט וההדגשה),
 * ובסוף שורה שמסתיימת בעברית ובסימן פיסוק. כך התצוגה קובעת לשורה כיוון מימין לשמאל,
 * והנקודה נשארת בסוף המשפט. בלוקי קוד והגדרות של קישורים לא משתנים.
 */
export function rtlMarks(text: string): string {
  if (!HEBREW.test(text)) {
    return text
  }

  const lines = text.split('\n')
  const mask = codeMask(lines)

  return lines.map((line, i) => (mask[i] === true || !HEBREW.test(line) ? line : markLine(line))).join('\n')
}
