/**
 * Reads WhatsApp's markup the way the app shows it, for the composer's preview.
 *
 * The preview used to print the raw text in one monospace box, asterisks and fences
 * included — which is neither what members see nor pleasant to read. WhatsApp shows the
 * message in the phone's own proportional font, `*bold*` as bold, and only a ``` block in
 * monospace. This splits the text into those pieces; the component draws them.
 *
 * It covers what this app emits and what an owner is likely to type: `*bold*`, `_italic_`,
 * `~strike~`, and ``` fences on lines of their own. Not inline ``` spans, and no nesting.
 * WhatsApp's own rules have more corners than that, and only a phone is authoritative —
 * this is a preview, and nothing it decides reaches the message that is sent.
 */

export interface Span {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
}

export type Segment =
  | { kind: 'text'; lines: Span[][] }
  | { kind: 'code'; text: string }

const FENCE = '```'

const STYLE: Record<string, keyof Omit<Span, 'text'>> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
}

/**
 * A marker pair counts only at word edges, as in WhatsApp: `snake_case_name` stays
 * literal, and so does `2*3*4`. The content must not start or end with a space.
 */
const INLINE = /([*_~])(\S(?:[^\n]*?\S)?)\1/g
const WORD = /[\p{L}\p{N}]/u

export function parseLine(line: string): Span[] {
  const spans: Span[] = []
  let last = 0

  for (const match of line.matchAll(INLINE)) {
    const start = match.index
    const end = start + match[0].length
    const before = line[start - 1]
    const after = line[end]
    if ((before && WORD.test(before)) || (after && WORD.test(after))) continue

    if (start > last) spans.push({ text: line.slice(last, start) })
    spans.push({ text: match[2], [STYLE[match[1]]]: true })
    last = end
  }

  if (last < line.length) spans.push({ text: line.slice(last) })
  return spans
}

export function parseWhatsApp(text: string): Segment[] {
  const lines = text.split('\n')
  const segments: Segment[] = []
  let prose: string[] = []

  const flushProse = () => {
    if (prose.length > 0) segments.push({ kind: 'text', lines: prose.map(parseLine) })
    prose = []
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === FENCE) {
      // An opener with no closer is literal in WhatsApp, so it stays text here too.
      const close = lines.findIndex((l, j) => j > i && l.trim() === FENCE)
      if (close !== -1) {
        flushProse()
        segments.push({ kind: 'code', text: lines.slice(i + 1, close).join('\n') })
        i = close
        continue
      }
    }
    prose.push(lines[i])
  }

  flushProse()
  return segments
}
