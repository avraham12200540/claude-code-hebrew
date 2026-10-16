// כותב את HEBREW.md מתוך hooks/rules.ts: הגרסה להעתקה ידנית, למי שלא יכול להתקין את התוסף.
// הרצה: node scripts/build-rules.mjs
import { writeFileSync } from 'node:fs'

import { rules } from '../hooks/rules.ts'

writeFileSync(new URL('../HEBREW.md', import.meta.url), `${rules('match', true)}\n`, 'utf8')
