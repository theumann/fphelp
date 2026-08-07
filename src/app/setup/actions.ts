'use server'

import { revalidatePath } from 'next/cache'

import { auth } from '@/auth'
import { assertOwner, isFinalised, saveSettings, setManagerEntry } from '@/db/queries'
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
