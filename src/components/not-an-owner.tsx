/**
 * Shown to a signed-in user who is not an owner of this league.
 *
 * Phrased as "you don't have access" rather than "no such page": they signed in
 * successfully, so pretending the page doesn't exist would read as a bug. It also says
 * who can fix it, because they cannot — membership is granted deliberately, and there is
 * no self-service route on purpose.
 */
export function NotAnOwner() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <div className="rounded-xl border border-line bg-surface p-5">
        <h1 className="text-lg font-semibold tracking-tight">
          You don&apos;t have access to this league
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          You&apos;re signed in, but your account isn&apos;t one of this league&apos;s owners.
          Access is granted deliberately rather than by signing up. Ask an existing owner
          to add you from their Setup page.
        </p>
      </div>
    </main>
  )
}
