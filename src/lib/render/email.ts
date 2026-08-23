import { formatCents } from '../digest/money'
import type { DigestStats, StandingRow } from '../digest/stats'
import {
  alignRows,
  ordinal,
  placeLines,
  prizeRows,
  type BlockSelection,
  type PrizeSummary,
} from './blocks'

/**
 * The HTML email, and its plaintext alternative.
 *
 * Built from `DigestStats` rather than from the WhatsApp strings, for two reasons that
 * both bite immediately if ignored:
 *
 *   - the text blocks carry WhatsApp's `*bold*` markers, which render as literal
 *     asterisks in an email client;
 *   - the text standings are a compact single-line-per-manager layout chosen to survive
 *     a 1,500 character URL budget. Email has no such budget, so it gets a real table
 *     and never truncates. Truncating here would drop managers for no reason at all.
 */

export interface RenderEmailInput {
  leagueName: string
  gameweek: number
  /** The owner's own prose, as typed. Line breaks are preserved; HTML is escaped. */
  body: string
  blocks: BlockSelection
  stats: DigestStats
  prize?: PrizeSummary
  signature?: string
}

export interface RenderedEmail {
  subject: string
  html: string
  /** Plaintext alternative. Not optional: an HTML-only email scores as spam. */
  text: string
}

/**
 * Escapes text for HTML.
 *
 * Applied to every interpolated value without exception — team names are attacker-
 * controlled in the sense that anyone in the league picks their own, and a name
 * containing `<` would otherwise break the layout of an email already sent to fourteen
 * people. Ampersand must be replaced first or the other replacements are re-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Local alias, so the many call sites below stay readable. */
const esc = escapeHtml

/** Colours are inline and literal: email clients strip <style> blocks and CSS variables. */
const C = {
  text: '#171717',
  muted: '#737373',
  rule: '#e5e5e5',
  stripe: '#fafafa',
} as const

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function heading(text: string): string {
  return `<h2 style="margin:24px 0 8px;font:600 16px/1.4 ${FONT};color:${C.text}">${esc(text)}</h2>`
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;font:400 15px/1.5 ${FONT};color:${C.text}">${text}</p>`
}

/** The owner's prose: escaped, then blank-line-separated into paragraphs. */
function renderBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ''

  return trimmed
    .split(/\n{2,}/)
    .map((para) => paragraph(esc(para).replace(/\n/g, '<br>')))
    .join('')
}

function movement(row: StandingRow): string {
  if (row.movement === null || row.movement === 0) return ''
  const up = row.movement > 0
  // Colour alone must not carry the meaning — the arrow says it too, which matters for
  // the plaintext alternative and for anyone who can't distinguish the two greens.
  return `<span style="color:${up ? '#15803d' : '#b91c1c'}">${up ? '▲' : '▼'}${Math.abs(row.movement)}</span>`
}

/**
 * The full standings table. Never truncated — see the note at the top of this file.
 *
 * A real `<table>` with inline styles, not flexbox: Outlook's renderer is Word's, and
 * anything modern collapses into a single unstyled column.
 */
function renderStandingsTable(stats: DigestStats): string {
  if (stats.standings.length === 0) return ''

  const rows = stats.standings
    .map((row, i) => {
      const bg = i % 2 === 1 ? ` background:${C.stripe};` : ''
      const cell = `padding:6px 8px;font:400 14px/1.4 ${FONT};color:${C.text};${bg}`

      if (row.pending || row.rank === null) {
        return (
          `<tr>` +
          `<td style="${cell}text-align:right;color:${C.muted}">–</td>` +
          `<td style="${cell}">${esc(row.entryName)}<br><span style="font-size:12px;color:${C.muted}">${esc(row.playerName)}</span></td>` +
          `<td style="${cell}text-align:right;color:${C.muted}" colspan="2">new</td>` +
          `</tr>`
        )
      }

      return (
        `<tr>` +
        `<td style="${cell}text-align:right;color:${C.muted}">${row.rank}</td>` +
        `<td style="${cell}">${esc(row.entryName)}<br><span style="font-size:12px;color:${C.muted}">${esc(row.playerName)}</span></td>` +
        `<td style="${cell}text-align:right;font-weight:600">${row.total}</td>` +
        `<td style="${cell}text-align:right">${movement(row)}</td>` +
        `</tr>`
      )
    })
    .join('')

  return (
    heading('Standings') +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule}">${rows}</table>`
  )
}

function renderGwResultsHtml(stats: DigestStats): string {
  const lines: string[] = []

  if (stats.gwWinners.length === 0) {
    lines.push('No scores yet.')
  } else {
    const names = stats.gwWinners.map((w) => `${w.playerName} (${w.eventTotal})`).join(', ')
    lines.push(
      `${stats.gwWinners.length > 1 ? 'Winners (tied)' : 'Winner'}: <strong>${esc(names)}</strong>`,
    )
    if (stats.leagueAverage !== null) {
      lines.push(`League average: ${Math.round(stats.leagueAverage)}`)
    }
    if (stats.biggestRiser) {
      lines.push(`Riser: ${esc(stats.biggestRiser.playerName)} ▲${stats.biggestRiser.places}`)
    }
    if (stats.biggestFaller) {
      lines.push(
        `Faller: ${esc(stats.biggestFaller.playerName)} ▼${Math.abs(stats.biggestFaller.places)}`,
      )
    }
  }

  return heading(`Gameweek ${stats.gameweek}`) + paragraph(lines.join('<br>'))
}

/**
 * The prize block: labels left, amounts right.
 *
 * A `<table>` rather than the monospace column WhatsApp needs — email has real layout, so
 * the figures can align in the body font instead of a smaller fixed-width one. Same rows
 * either way, from `prizeRows`.
 */
function renderPrizeHtml(prize: PrizeSummary): string {
  const cell = `padding:4px 0;font:400 15px/1.5 ${FONT};color:${C.text}`
  const amountCell = `${cell};text-align:right;white-space:nowrap`

  const rows = prizeRows(prize).map((row) => {
    // The pot is the figure everything else is measured against, so it carries the weight.
    const strong = row.label === 'Pot'
    const amount = esc(formatCents(row.cents, prize.currency))
    return (
      `<tr>` +
      `<td style="${cell}">${esc(row.label)}</td>` +
      `<td style="${amountCell}${row.cents < 0 ? `;color:${C.muted}` : ''}">` +
      `${strong ? `<strong>${amount}</strong>` : amount}</td>` +
      `</tr>`
    )
  })

  // Each place's share is a slice of the remainder, so it is unknowable without a pot.
  if (prize.potSet && prize.rankPrizeCents.length > 0) {
    rows.push(
      `<tr><td colspan="2" style="${cell};padding-top:12px;color:${C.muted};font-size:13px">Final table</td></tr>`,
    )
    for (const [i, cents] of prize.rankPrizeCents.entries()) {
      rows.push(
        `<tr>` +
          `<td style="${cell}">${ordinal(i + 1)}</td>` +
          `<td style="${amountCell}">${esc(formatCents(cents, prize.currency))}</td>` +
          `</tr>`,
      )
    }
  }

  return (
    heading('Prizes') +
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:0 0 12px">${rows.join('')}</table>`
  )
}

/** The plaintext alternative. Mirrors the HTML, without WhatsApp's `*bold*` markers. */
function renderText(input: RenderEmailInput): string {
  const parts: string[] = []
  const body = input.body.trim()
  if (body) parts.push(body)

  if (input.blocks.gwResults) {
    const lines = [`Gameweek ${input.stats.gameweek}`]
    if (input.stats.gwWinners.length === 0) {
      lines.push('No scores yet.')
    } else {
      const names = input.stats.gwWinners.map((w) => `${w.playerName} (${w.eventTotal})`).join(', ')
      lines.push(`${input.stats.gwWinners.length > 1 ? 'Winners (tied)' : 'Winner'}: ${names}`)
      if (input.stats.leagueAverage !== null) {
        lines.push(`League average: ${Math.round(input.stats.leagueAverage)}`)
      }
    }
    parts.push(lines.join('\n'))
  }

  if (input.blocks.overallStandings && input.stats.standings.length > 0) {
    const lines = ['Standings']
    for (const row of input.stats.standings) {
      if (row.pending || row.rank === null) {
        lines.push(`–  ${row.entryName} (${row.playerName}) — new`)
        continue
      }
      const move =
        row.movement === null || row.movement === 0
          ? ''
          : ` ${row.movement > 0 ? '▲' : '▼'}${Math.abs(row.movement)}`
      lines.push(`${row.rank}. ${row.entryName} — ${row.total}${move}`)
    }
    parts.push(lines.join('\n'))
  }

  if (input.blocks.prizeStructure && input.prize) {
    const prize = input.prize
    // The third renderer of this block, alongside `renderPrizeHtml` here and WhatsApp's
    // `renderPrizeStructure`. All three have to agree to omit a pot nobody has set — this
    // one was missed until a test asked for the plaintext body as well as the HTML. They
    // share `prizeRows` now, so the omission is decided once.
    const lines = ['Prizes', ...alignRows(prizeRows(prize), prize.currency)]
    // Padded rather than proportional, like WhatsApp's block and for the same reason:
    // plaintext mail has no layout, so columns are the only alignment available. No ```
    // fences, which are WhatsApp's markup and would read as literal backticks here.
    if (prize.potSet && prize.rankPrizeCents.length > 0) {
      lines.push('', ...placeLines(prize))
    }
    parts.push(lines.join('\n'))
  }

  if (input.signature?.trim()) parts.push(input.signature.trim())

  return parts.join('\n\n')
}

/**
 * Renders the digest as an email.
 *
 * Block order matches the WhatsApp composer — prose, results, standings, prizes,
 * signature — so an owner who sends both channels isn't comparing two different
 * documents.
 */
export function renderEmail(input: RenderEmailInput): RenderedEmail {
  const sections = [
    renderBody(input.body),
    input.blocks.gwResults ? renderGwResultsHtml(input.stats) : '',
    input.blocks.overallStandings ? renderStandingsTable(input.stats) : '',
    input.blocks.prizeStructure && input.prize ? renderPrizeHtml(input.prize) : '',
  ]

  const signature = input.signature?.trim()
    ? `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${C.rule};font:400 13px/1.5 ${FONT};color:${C.muted}">${esc(input.signature.trim())}</p>`
    : ''

  const html =
    `<div style="margin:0 auto;max-width:600px;padding:24px;background:#ffffff">` +
    sections.filter(Boolean).join('') +
    signature +
    `</div>`

  return {
    subject: `${input.leagueName} - Gameweek ${input.gameweek}`,
    html,
    text: renderText(input),
  }
}
