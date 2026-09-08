import { createEffect, createMemo, createSignal, Show } from "solid-js"
import type { RegisteredPanel } from "./provider"

/** Related instances can retain a shared sidebar while switching their document content. */
export function ExtensionPanelContent(props: { panels: readonly RegisteredPanel[]; active: string | undefined }) {
  const selected = createMemo(() => props.panels.find((panel) => panel.key === props.active))
  const [content, setContent] = createSignal<{ key: string; render: RegisteredPanel["render"] }>()
  // Resolve after declarations update. Preview replacement removes and inserts
  // panel declarations in the same render, and must retain the shared content.
  createEffect(() => {
    const panel = selected()
    const key = panel && `${panel.session.key}/${panel.plugin}/${panel.props.group ?? panel.key}`
    setContent((previous) => previous?.key === key ? previous : panel && { key: key!, render: panel.render })
  })
  return (
    <Show when={content()} keyed>
      {(content) => (
        <div
          role="tabpanel"
          data-slot="tabs-content"
          class="h-full min-h-0 overflow-hidden flex flex-col"
          aria-label={selected()?.props.title}
        >
          {content.render()}
        </div>
      )}
    </Show>
  )
}
