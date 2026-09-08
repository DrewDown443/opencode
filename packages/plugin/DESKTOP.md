# Desktop extensions — exploratory API

This draft adds a renderer entrypoint at `@opencode/plugin/desktop` and a trusted main entrypoint at `@opencode/plugin/desktop/main`. Built-in/static registrations run through the same contracts external packages can import. Installing and resolving arbitrary third-party renderer packages is a follow-up; this draft does not add a second package manager or a sandbox.

## Contributions

Active routes expose `session.services`: workspace file caches and selection,
draft attachments, annotations, tab references, scroll state, and panel/sidebar
layout controls. These services exist while the session route is mounted. Stable
session identity and the public client remain available while its shell tab is open.
Feature queries stay in the extension and use TanStack Query.

Panels can use a shared `reference` (for example a `file://` resource) so existing
document producers can select them. `initial: "closed"` separates availability from
opening, `default` selects a fallback, and `closable: false` declares a pinned panel.
`view.tabs.canClose(reference)` lets a feature count user-opened tabs without knowing
which extensions supply pinned defaults. The host retains activated `group` content
while a declaration in that group exists, so replacing a file preview preserves its
surrounding sidebar. Group identity includes the server and session.

Session controls can use `session.header.actions`, `session.panel.toolbar`,
`session.panel.tools`, and `session.sidebar`. Each receives the session input and
uses the shared placement rules. Renderer contexts also expose shared translations,
notifications, file export, and available native path actions.

```tsx
import { Plugin } from "@opencode/plugin/desktop"
import { Panel } from "@opencode/plugin/desktop/solid"
import { Button } from "@opencode/ui/button"

export default Plugin.define({
  id: "example.inspector",
  setup(ctx) {
    ctx.ui.slot({
      append: "session.panel",
      when: () => available(),
      render: ({ session }) => (
        <Panel id="inspector" title={title()} onClose={close}>
          <Inspector session={session} />
        </Panel>
      ),
    })
  },
})
```

Slots share the TUI resolver and its `append`, `prepend`, `before`, `after`, and `replace` rules. The plugin controls `when`, commands, and opening. Panel IDs are scoped to the plugin. Multiple reactive `Panel` instances share the host's ordered, closable tab strip. Closing, hiding, and disposing content are separate operations. Panel declarations live with the session route, even when the panel is closed.

Use the host's UI components directly. `@opencode/ui/layout` supplies shared layout, toolbar, form, text, and settings-row components. The browser companion in the next layer uses these components rather than shipping private CSS. Solid and TanStack remain normal libraries; the SDK adds no query framework.

## Lifetimes and data

- `ctx.sessions.list()` contains sessions visited by each open shell tab, retaining child-session ownership across navigation. `current()` is the currently routed session.
- Every session carries stable server, shell-tab, and session identities. Its server provides the existing client and reactive data APIs.
- `ctx.lifecycle.own` owns custom cleanup; its signal aborts on unload. Slots, commands and main RPC subscriptions are owned automatically.
- `storage.store` uses the host's persistence and cross-window synchronization. `storage.memory` retains window-local values across extension reloads. Schema-specific migrations remain an open API design item.
- `commands.register` accepts a reactive command list and registers with the existing command palette, keyboard, and slash-command host. IDs are plugin-scoped.
- `i18n` resolves existing host keys through the active language. Extension-owned translation catalogs are a follow-up.

## Local main entrypoint

`MainPlugin.define({ id, rpc, setup })` uses a public `Rpc.define` contract. Inputs, outputs and events are decoded/encoded at the bridge. Effect codecs can carry bytes over the JSON envelope, and Standard Schema/JSON Schema are supported. Methods receive a cancellation signal. Null is the void wire value.

Main context exposes the owning Electron window, a lifecycle, authenticated Node-side OpenCode clients for host-known server IDs, and a native surface registrar. It does not import Core. A renderer calls `ctx.main.rpc(contract)` and subscribes to its events.

`ctx.surfaces.register(view)` returns an opaque, window/extension-owned ID. `<NativeSurface id={id} />` presents that view. The host owns bounds, zoom conversion, corner composition, and menu/dialog occlusion. The extension owns the view's domain behavior and disposal.

## Verification

The pre-change production benchmark is `desktop-extensions-before`, at base `c3f1bdaf97`. Two samples per scenario completed: cold/closed first-correct median 223.60 ms, cold/open 255.75 ms, warm/closed 57.70 ms, warm/open 95.55 ms, warm/resized 92.85 ms. These are exploratory measurements, not machine-independent thresholds.

Focused tests cover lifecycle teardown, codec validation and binary round trips, shared slot ordering, and actual application panel behavior through an independent fixture plugin. The dependent browser extraction exercises native surfaces and server RPC.
