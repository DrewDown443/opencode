import { createMemo, Show } from "solid-js"
import type { RegisteredPanel } from "./provider"

/** Related instances can retain a shared sidebar while switching their document content. */
export function ExtensionPanelContent(props: { panels: readonly RegisteredPanel[]; active: string | undefined }) {
  const selected = createMemo(() => props.panels.find((panel) => panel.key === props.active))
  const content = createMemo(
    () => {
      const panel = selected()
      return panel && { key: `${panel.plugin}/${panel.props.group ?? panel.key}`, render: panel.render }
    },
    undefined,
    { equals: (previous, next) => previous?.key === next?.key },
  )
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
