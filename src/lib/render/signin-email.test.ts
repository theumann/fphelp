import { describe, expect, it } from 'vitest'

import { renderSignInEmail } from './signin-email'

const URL = 'https://fphelp.app/api/auth/callback/resend?token=abc123&email=a%40b.test'

describe('renderSignInEmail', () => {
  it('links the button at the sign-in URL', () => {
    const { html } = renderSignInEmail(URL)
    expect(html).toContain(`href="${URL.replace(/&/g, '&amp;')}"`)
    expect(html).toContain('Sign in to FPheLp')
  })

  /**
   * The button is not enough on its own. A client that strips HTML, or a tap that silently
   * does nothing, would otherwise leave the recipient with no way into the app at all —
   * and this email is the only way in.
   */
  it('still shows the raw URL as a fallback', () => {
    const { html, text } = renderSignInEmail(URL)
    expect(html).toContain(URL.replace(/&/g, '&amp;'))
    expect(text).toContain(URL)
  })

  /** An HTML-only email scores as spam, and a sign-in link in spam reads as broken auth. */
  it('always carries a plaintext alternative', () => {
    const { text } = renderSignInEmail(URL)
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).not.toContain('<')
  })

  /**
   * The warning that exists because of a real incident: chat apps fetch a URL to build a
   * preview, which spends a single-use token before the owner taps it.
   */
  it('warns against forwarding the link through a chat app', () => {
    const { html, text } = renderSignInEmail(URL)
    for (const body of [html, text]) {
      expect(body).toMatch(/WhatsApp/)
      expect(body).toMatch(/device/i)
    }
  })

  it('escapes the URL rather than interpolating it raw', () => {
    const { html } = renderSignInEmail('https://x.test/?a=1&b="><script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })
})
