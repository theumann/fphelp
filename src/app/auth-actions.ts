'use server'

import { signOut } from '@/auth'

/**
 * Signs the current owner out and returns them to the sign-in page.
 *
 * A Server Action rather than a link to `/api/auth/signout`: that route renders
 * Auth.js's own confirmation page, which is unstyled and says "Sign out?" on a blank
 * screen — jarring enough on a phone to look broken.
 *
 * No owner check. Signing out is the one action that needs no authorisation, and
 * calling it while already signed out is a no-op rather than an error.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/signin' })
}
