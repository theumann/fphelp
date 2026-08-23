'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import {
  addOwner,
  addRecipients,
  assertOwner,
  isFinalised,
  ownerCount,
  removeOwner,
  removeRecipient,
  saveSettings,
  setDefaultBlocks,
  setEmailEnabled,
  setHideRecipients,
  setManagerEntry,
} from '@/db/queries'
import { parseRecipient, parseRecipientList } from '@/lib/email/recipients'
import { validateSettings, type LeagueSettings } from '@/lib/league-settings'
import type { BlockSelection } from '@/lib/render/blocks'

export interface SaveSettingsResult {
  ok: boolean
  errors: string[]
}

/**
 * Persists league settings.
 *
 * Validation runs here as well as in the form. The client's copy is convenience; this
 * one is the guarantee, since a Server Action is a public endpoint that can be called
 * with anything.
 */
export async function saveSettingsAction(input: {
  leagueId: string
  settings: LeagueSettings
  gameweekCount: number
  managerCount: number
}): Promise<SaveSettingsResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, errors: ['Not signed in'] }
  await assertOwner(input.leagueId, session.user.id)

  // Prize rules lock once the ledger is settled — editing them afterwards would rewrite
  // winnings that have already been paid out.
  if (await isFinalised(input.leagueId)) {
    return {
      ok: false,
      errors: ['This season is finalised - prize rules can no longer be changed.'],
    }
  }

  const problems = validateSettings(input.settings, input.gameweekCount, input.managerCount)
  if (problems.length > 0) {
    return { ok: false, errors: problems.map(describe) }
  }

  await saveSettings(input.leagueId, input.settings)

  revalidatePath('/send')
  revalidatePath('/setup')
  return { ok: true, errors: [] }
}

/**
 * Records which FPL entry the signed-in owner plays as.
 *
 * Its own action, saving on change, rather than a passenger on the settings form. It sits
 * on a different axis from everything that form validates: the pot, the prizes and the
 * expenses are the league's and shared between co-owners, while this is one owner's own
 * and signs only the messages they send. It rode along with Save because both ended up in
 * one component, which is also why it had to appear under the prize arithmetic it has
 * nothing to do with.
 *
 * Nothing to validate here beyond ownership — an entry either is one of the league's
 * managers or the owner does not play, and both are legitimate.
 */
export async function setManagerEntryAction(input: {
  leagueId: string
  managerEntry: number | null
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await setManagerEntry(input.leagueId, session.user.id, input.managerEntry)

  // `/send` builds the signature from this row at render time, so it is the page that
  // actually changes.
  revalidatePath('/send')
  revalidatePath('/setup')
}

export interface AddRecipientsResult {
  ok: boolean
  added: number
  /** Already on the list — reported so a re-paste is visibly a no-op, not a failure. */
  skipped: number
  /** Entries that could not be parsed, verbatim. */
  invalid: string[]
}

/**
 * Adds pasted addresses to the league's email list.
 *
 * Reports what happened to every entry rather than a bare success: the owner maintains
 * this list by hand against a roster the API won't give them, so "14 pasted, 12 added"
 * is the only way they would notice two were malformed.
 */
export async function addRecipientsAction(input: {
  leagueId: string
  raw: string
}): Promise<AddRecipientsResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, added: 0, skipped: 0, invalid: [] }
  await assertOwner(input.leagueId, session.user.id)

  const { valid, invalid, duplicates } = parseRecipientList(input.raw)
  const { added, skipped } = await addRecipients(input.leagueId, valid)

  revalidatePath('/setup')
  // Duplicates within the paste and addresses already stored are the same thing to the
  // owner: an address they meant to add that is now present exactly once.
  return { ok: true, added, skipped: skipped + duplicates.length, invalid }
}

export async function removeRecipientAction(input: { leagueId: string; id: string }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await removeRecipient(input.leagueId, input.id)
  revalidatePath('/setup')
}

/**
 * Sets which blocks a new draft starts with.
 *
 * Saves on each toggle rather than behind the settings form's Save button, because it is a
 * discrete choice like the email switch, not part of the prize arithmetic that has to be
 * validated as a whole.
 */
export async function setDefaultBlocksAction(input: {
  leagueId: string
  blocks: BlockSelection
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await setDefaultBlocks(input.leagueId, input.blocks)
  revalidatePath('/setup')
  revalidatePath('/send')
}

/**
 * Switches between bcc'ing recipients and cc'ing them.
 *
 * Turning hiding *off* is the consequential direction: from the next send onward every
 * member sees every address, and that cannot be walked back. The confirmation lives in the
 * UI copy rather than here, because this is also how it gets switched back on.
 */
export async function setHideRecipientsAction(input: { leagueId: string; hide: boolean }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await setHideRecipients(input.leagueId, input.hide)
  revalidatePath('/setup')
  revalidatePath('/send')
}

/** Email is opt-in per league; a WhatsApp-only league never maintains a list. */
export async function setEmailEnabledAction(input: { leagueId: string; enabled: boolean }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await setEmailEnabled(input.leagueId, input.enabled)
  revalidatePath('/setup')
  revalidatePath('/send')
}

export type AddOwnerResult =
  | { ok: true; outcome: 'added' | 'already-owner'; email: string }
  | { ok: false; error: string }

/**
 * Grants another person ownership of this league.
 *
 * The counterpart to the allowlist in `src/auth.ts`: until this runs, an address cannot
 * sign in at all. It is deliberately not an invite — no token, no email, no self-signup.
 * The added owner gets in by requesting a sign-in link themselves, which keeps the
 * property that the app never mails an address that did not ask it to.
 */
export async function addOwnerAction(input: {
  leagueId: string
  raw: string
}): Promise<AddOwnerResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' }
  await assertOwner(input.leagueId, session.user.id)

  const parsed = parseRecipient(input.raw)
  if (!parsed) return { ok: false, error: `“${input.raw.trim()}” is not an email address.` }

  const { outcome } = await addOwner(input.leagueId, parsed.email, parsed.name)

  revalidatePath('/setup')
  return { ok: true, outcome, email: parsed.email }
}

export type RemoveOwnerResult = { ok: true } | { ok: false; error: string }

/**
 * Revokes another owner's access.
 *
 * Two removals are refused rather than confirmed. Removing the last owner would leave
 * the league with no one able to administer it and no way back in short of a redeploy,
 * since membership can only be granted from inside. Removing yourself is the same
 * mistake one step removed — a co-owner can do it for you, and then the person losing
 * access is not also the person who has to be sure.
 */
export async function removeOwnerAction(input: {
  leagueId: string
  userId: string
}): Promise<RemoveOwnerResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' }
  await assertOwner(input.leagueId, session.user.id)

  if (input.userId === session.user.id) {
    return { ok: false, error: 'You cannot remove yourself. Ask a co-owner to do it.' }
  }

  if ((await ownerCount(input.leagueId)) <= 1) {
    return { ok: false, error: 'A league must keep at least one owner.' }
  }

  await removeOwner(input.leagueId, input.userId)
  revalidatePath('/setup')
  return { ok: true }
}

function describe(error: ReturnType<typeof validateSettings>[number]): string {
  switch (error.code) {
    case 'fixed-exceeds-pot': {
      const total = error.committedCents + error.expensesCents
      const what = error.expensesCents > 0 ? 'Fixed prizes and expenses total' : 'Fixed prizes total'
      return `${what} ${(total / 100).toFixed(2)}, which is more than the pot of ${(error.potCents / 100).toFixed(2)}.`
    }
    case 'expense-missing-label':
      return `Expense ${error.index + 1} has no name.`
    case 'non-positive-expense':
      return `The expense “${error.label}” is not a positive amount.`
    case 'percentages-not-100':
      return `Place percentages add up to ${error.sum}%, not 100%.`
    case 'no-paid-places':
      return 'Add at least one paid place.'
    case 'non-positive-percentage':
      return `Place ${error.rank} is worth 0% - remove it instead.`
    case 'more-places-than-managers':
      return `${error.places} paid places but only ${error.managers} managers in the league.`
  }
}
