import { parseWhatsApp, type Span } from '@/lib/render/whatsapp-format'

function SpanView({ span }: { span: Span }) {
  let node: React.ReactNode = span.text
  if (span.strike) node = <s>{node}</s>
  if (span.italic) node = <em>{node}</em>
  if (span.bold) node = <strong className="font-semibold">{node}</strong>
  return node
}

/**
 * The message as a sent bubble: the phone's own font, `*bold*` drawn bold, and only the
 * ``` block in monospace — the way members see it, rather than the raw text with its
 * markup showing. An approximation; a phone is the authority on WhatsApp rendering.
 *
 * The bubble's colours are tokens (`--chat-bubble`), so it follows the theme.
 */
export function WhatsAppPreview({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">Nothing to send yet.</p>
  }

  return (
    // No height cap: a scroll box inside a scrolling page is awkward on a phone, and the
    // message is bounded by the length budget anyway. `items-start` keeps the bubble at its
    // own height — stretched, it was clipped to the box while its text ran on below it.
    // Centred, not right-aligned as a sent message is in WhatsApp: inside a card, the
    // offset read as a misalignment rather than as a chat layout.
    <div className="flex items-start justify-center rounded-lg bg-surface-muted p-3">
      <div className="flex max-w-[92%] min-w-0 flex-col gap-2 rounded-lg rounded-tr-none bg-chat-bubble px-3 py-2 font-system text-[15px] leading-snug text-chat-bubble-foreground shadow-sm">
        {parseWhatsApp(text).map((segment, i) =>
          segment.kind === 'code' ? (
            <pre key={i} className="overflow-x-auto font-mono text-[13px] leading-snug">
              {segment.text}
            </pre>
          ) : (
            <p key={i} className="break-words">
              {segment.lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {line.map((span, k) => (
                    <SpanView key={k} span={span} />
                  ))}
                </span>
              ))}
            </p>
          ),
        )}
      </div>
    </div>
  )
}
