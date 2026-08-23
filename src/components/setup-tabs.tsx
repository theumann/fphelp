'use client'

import { useState, type ReactNode } from 'react'

import { TabStrip } from './ui'

export interface SetupTab {
  /** Also the `?tab=` value, so a link can open the page on this panel. */
  id: string
  label: string
  panel: ReactNode
}

/**
 * Setup's three panels.
 *
 * The page had grown to five stacked sections and a phone's worth of scrolling between
 * the pot and the recipient list. The split follows how the settings actually behave
 * rather than what they are about: the money panel is the one place with a Save button,
 * and everything in the other two writes on click. One save model per panel is what stops
 * the sticky bar from looking like it governs sections that ignore it.
 *
 * **Every panel stays mounted**, hidden with `hidden` rather than unmounted. The money
 * form holds unsaved edits in component state, so unmounting it — which is what a
 * server-rendered `?tab=` link or a route change would do — would silently discard a
 * half-typed pot on a tab switch. Hiding costs a little markup and makes losing work
 * impossible.
 *
 * The URL is kept in step with `replaceState`, which updates the address bar without
 * asking Next to navigate. So `/setup?tab=people` opens on that panel and a switch is
 * linkable, without a round trip that would take the draft with it.
 */
export function SetupTabs({ tabs, initial }: { tabs: SetupTab[]; initial?: string }) {
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
        label="Setup sections"
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
