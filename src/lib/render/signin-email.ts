import { escapeHtml } from './email'

/**
 * The sign-in email.
 *
 * Kept as a pure function rather than inlined in `src/auth.ts` so it can be tested: what
 * this email says is load-bearing, and it is otherwise only observable by asking for a
 * link and reading your own inbox.
 *
 * HTML *and* plaintext. The plaintext alternative is not optional — an HTML-only email
 * scores as spam, and the same rule already governs the digest.
 */

export interface SignInEmail {
  subject: string
  html: string
  text: string
}

/** The middle of the logo gradient. Solid, because Outlook will not render a gradient. */
const BRAND = '#2762e1'

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

const TEXT = '#171717'
const MUTED = '#737373'

/**
 * Why the "open it on this device" warning is in the email rather than a support note.
 *
 * A sign-in link is single-use, and every chat app fetches a URL to build its preview
 * card — that fetch verifies the token, spends it, and takes the session. The owner's own
 * tap then arrives second and fails with `error=Verification`, which reads as broken auth.
 * This happened in production on 2026-08-17, three times, forwarding a link through
 * WhatsApp to move it from a desktop inbox to a phone.
 *
 * The person who needs this warning is holding the email at the moment they are about to
 * make the mistake, so this is where it belongs.
 */
const FORWARD_WARNING =
  'Open this on the device you want to sign in on. Forwarding it through WhatsApp, ' +
  'iMessage or Slack spends the link before you can use it.'

const EXPIRY_NOTE = 'This link works once, and expires shortly.'

export function renderSignInEmail(url: string): SignInEmail {
  const href = escapeHtml(url)

  const html =
    `<div style="margin:0 auto;max-width:600px;padding:24px;background:#ffffff">` +
    `<p style="margin:0 0 20px;font:400 16px/1.5 ${FONT};color:${TEXT}">` +
    `Tap the button to sign in to FPheLp.</p>` +
    // A table, not a padded <a>: Outlook ignores padding on inline elements, which would
    // collapse the button into bare underlined text.
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">` +
    `<tr><td style="border-radius:8px;background:${BRAND}">` +
    `<a href="${href}" style="display:inline-block;padding:14px 28px;font:600 16px/1 ${FONT};` +
    `color:#ffffff;text-decoration:none;border-radius:8px">Sign in to FPheLp</a>` +
    `</td></tr></table>` +
    `<p style="margin:0 0 20px;font:400 14px/1.5 ${FONT};color:${MUTED}">` +
    `${escapeHtml(FORWARD_WARNING)}</p>` +
    `<p style="margin:0 0 8px;font:400 13px/1.5 ${FONT};color:${MUTED}">` +
    `If the button doesn't work, paste this into your browser:</p>` +
    // The raw URL stays visible. A button alone is unrecoverable when the client strips
    // HTML or the tap silently fails, and this is the only way into the app.
    `<p style="margin:0 0 20px;font:400 12px/1.5 ${FONT};color:${MUTED};word-break:break-all">` +
    `${href}</p>` +
    `<p style="margin:0;padding-top:16px;border-top:1px solid #e5e5e5;font:400 12px/1.5 ${FONT};color:${MUTED}">` +
    `${escapeHtml(EXPIRY_NOTE)} If you didn't ask to sign in, ignore this email. Nothing ` +
    `happens until the link is opened.</p>` +
    `</div>`

  const text = [
    'Sign in to FPheLp:',
    '',
    url,
    '',
    FORWARD_WARNING,
    '',
    `${EXPIRY_NOTE} If you didn't ask to sign in, ignore this email.`,
  ].join('\n')

  return { subject: 'Your FPheLp sign-in link', html, text }
}
