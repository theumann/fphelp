'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import {
  addRecipients,
  assertOwner,
  isFinalised,
  removeRecipient,
  saveSettings,
  setEmailEnabled,
  setManagerEntry,
} from '@/db/queries'
import { parseRecipientList } from '@/lib/email/recipients'
import { validateSettings, type LeagueSettings } from '@/lib/league-settings'

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
  managerEntry: number | null
}): Promise<SaveSettingsResult> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, errors: ['Not signed in'] }
  await assertOwner(input.leagueId, session.user.id)

  // Prize rules lock once the ledger is settled — editing them afterwards would rewrite
  // winnings that have already been paid out.
  if (await isFinalised(input.leagueId)) {
    return {
      ok: false,
      errors: ['This season is finalised — prize rules can no longer be changed.'],
    }
  }

  const problems = validateSettings(input.settings, input.gameweekCount, input.managerCount)
  if (problems.length > 0) {
    return { ok: false, errors: problems.map(describe) }
  }

  await saveSettings(input.leagueId, input.settings)
  await setManagerEntry(input.leagueId, session.user.id, input.managerEntry)

  revalidatePath('/send')
  revalidatePath('/setup')
  return { ok: true, errors: [] }
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

/** Email is opt-in per league; a WhatsApp-only league never maintains a list. */
export async function setEmailEnabledAction(input: { leagueId: string; enabled: boolean }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not signed in')
  await assertOwner(input.leagueId, session.user.id)

  await setEmailEnabled(input.leagueId, input.enabled)
  revalidatePath('/setup')
  revalidatePath('/send')
}

function describe(error: ReturnType<typeof validateSettings>[number]): string {
  switch (error.code) {
    case 'fixed-exceeds-pot':
      return `Fixed prizes total ${(error.committedCents / 100).toFixed(2)}, which is more than the pot of ${(error.potCents / 100).toFixed(2)}.`
    case 'percentages-not-100':
      return `Place percentages add up to ${error.sum}%, not 100%.`
    case 'no-paid-places':
      return 'Add at least one paid place.'
    case 'non-positive-percentage':
      return `Place ${error.rank} is worth 0% — remove it instead.`
    case 'more-places-than-managers':
      return `${error.places} paid places but only ${error.managers} managers in the league.`
  }
}
