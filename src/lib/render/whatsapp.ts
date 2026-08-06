/**
 * WhatsApp deep-link construction.
 *
 * The critical rule: NEVER include a phone number. `wa.me/<number>?text=` opens that
 * individual chat directly and makes group sending impossible — while still looking
 * like a perfectly good link. Omitting the number is what makes WhatsApp show a chat
 * picker, which is how the owner reaches their league group.
 */

export interface WhatsAppLinks {
  /** Preferred on mobile — opens the app directly. */
  app: string
  /** Fallback for desktop, or when the custom scheme has no handler. */
  web: string
}

export function buildWhatsAppLinks(text: string): WhatsAppLinks {
  const encoded = encodeURIComponent(text)
  return {
    app: `whatsapp://send?text=${encoded}`,
    web: `https://wa.me/?text=${encoded}`,
  }
}

/**
 * Guards the rule above.
 *
 * Exported so it can be asserted in tests and, if we ever build links from user input,
 * at runtime. A number sneaking in produces a link that works when you tap it and
 * silently cannot reach a group — the worst kind of bug to ship.
 */
export function assertNoPhoneNumber(url: string): void {
  const [base] = url.split('?')

  // Anything between the host and the query is a recipient: wa.me/447700900000 or
  // whatsapp://send/44770...
  const offending =
    /^https?:\/\/wa\.me\/[^?]+/.test(base) || /^whatsapp:\/\/send\/[^?]+/.test(base)

  if (offending) {
    throw new Error(
      `WhatsApp link contains a recipient: ${base}. A number makes groups unreachable — ` +
        `use whatsapp://send?text= or https://wa.me/?text= with no number.`,
    )
  }
}
