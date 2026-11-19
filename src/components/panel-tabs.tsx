'use client'

import { useState, type ReactNode } from 'react'

import { TabStrip } from './ui'

export interface PanelTab {
  /** Also the `?tab=` value, so a link can open the page on this panel. */
  id: string
  label: string
  panel: ReactNode
}

/**
 * A page split into panels — Setup's three, and Dues' two.
 *
 * Setup had grown to five stacked sections and a phone's worth of scrolling between the
 * pot and the recipient list; Dues put the winnings ledger under an eighteen-row
 * checklist. Setup splits by how its settings save (the money panel is the one place
 * with a Save button), Dues by direction of money — in, and out.
 *
 * **Every panel stays mounted**, hidden with `hidden` rather than unmounted. Setup's money
 * form holds unsaved edits in component state, and the dues list holds optimistic ticks;
 * unmounting either — which is what a server-rendered `?tab=` link or a route change
 * would do — would silently discard them on a tab switch. Hiding costs a little markup
 * and makes losing work impossible.
 *
 * The URL is kept in step with `replaceState`, which updates the address bar without
 * asking Next to navigate. So `/setup?tab=people` opens on that panel and a switch is
 * linkable, without a round trip that would take the draft with it.
 */
export function PanelTabs({
  tabs,
  initial,
  label,
}: {
  tabs: PanelTab[]
  initial?: string
  /** Names the strip for screen readers: "Setup sections", "Money in and out". */
  label: string
}) {
  const [active, setActive] = useState(
    () => tabs.find((t) => t.id === initial)?.id ?? tabs[0].id,
  )

  function select(id: string) {
    setActive(id)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', id)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="flex flex-col gap-5">
      <TabStrip
        tabs={tabs.map(({ id, label }) => ({ id, label }))}
        active={active}
        onSelect={select}
        label={label}
      />

      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            hidden={!selected}
            // The class as well as the attribute: `hidden` is `display: none`, which a
            // `flex` class on the same element would win against.
            className={selected ? 'flex flex-col gap-5' : 'hidden'}
          >
            {tab.panel}
          </div>
        )
      })}
    </div>
  )
}
