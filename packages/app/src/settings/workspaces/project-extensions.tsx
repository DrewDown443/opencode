import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { Tabs } from "@opencode/ui/tabs"
import { type Component, For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useMcpToggle } from "@/providers/connect/mcp"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { pluginLabels } from "@/providers/catalog/plugin"
import { ExternalLink } from "@/runtime/platform/external-link"
import "./project.css"

type SkillItem = {
  name: string
  location: string
}

const skillKey = (item: SkillItem) => `${item.name}\n${item.location}`

const ExtensionCard: Component<{ children: JSX.Element }> = (props) => (
  <div class="project-settings-extension-card settings-extension-list">{props.children}</div>
)

const ExtensionRow: Component<{
  icon: "mcp" | "cube" | "post-skill"
  name: string
  children?: JSX.Element
}> = (props) => (
  <div class="project-settings-extension-row">
    <div class="project-settings-extension-row-main">
      <Icon name={props.icon} class="project-settings-extension-row-icon" />
      <span class="project-settings-extension-row-name settings-extension-name">{props.name}</span>
    </div>
    {props.children}
  </div>
)

const ProjectSectionHeader: Component<{
  kind: "mcps" | "plugins" | "skills"
  empty: boolean
  action: JSX.Element
}> = (props) => {
  const language = useLanguage()
  return (
    <div class="project-settings-extension-section-header">
      <div class="project-settings-extension-section-copy">
        <span>
          {props.empty
            ? language.t(`project.settings.extensions.empty.${props.kind}.title`)
            : language.t("project.settings.extensions.added")}
        </span>
        <Show when={props.empty}>
          <span class="project-settings-extension-empty-description">
            {language.t(`project.settings.extensions.empty.${props.kind}.description`)}
          </span>
        </Show>
      </div>
      {props.action}
    </div>
  )
}

const SharedSection: Component<{
  count: number
  children: JSX.Element
}> = (props) => {
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  return (
    <Show when={props.count > 0}>
      <div class="project-settings-shared">
        <button
          type="button"
          class="settings-models-group-trigger project-settings-shared-trigger"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <span class="settings-models-group-chevron">
            <Icon
              name="fill-triangle-down"
              size="small"
              classList={{ "project-settings-shared-chevron": true, open: open() }}
            />
          </span>
          <span class="project-settings-shared-label">
            <span class="settings-models-group-title">{language.t("project.settings.extensions.shared")}</span>
            <span class="project-settings-shared-count">{props.count}</span>
          </span>
        </button>
        <Show when={open()}>
          <ExtensionCard>{props.children}</ExtensionCard>
        </Show>
      </div>
    </Show>
  )
}

export const ProjectSettingsExtensions: Component = () => {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const directorySDK = useWorkspaceLocation()
  const data = useData()
  const toggleMcp = useMcpToggle(() => directorySDK().directory)

  createEffect(() => {
    if (serverSDK.connection.status() !== "connected") return
    const ref = { directory: directorySDK().directory }
    void Promise.all([
      data.location.mcp.server.sync(),
      data.location.skill.sync(),
      data.location.mcp.server.sync(ref),
      data.location.skill.sync(ref),
    ]).catch(() => undefined)
  })

  const globalMcpNames = createMemo(() =>
    [...new Set((data.location.mcp.server.list() ?? []).map((server) => server.name))].sort(),
  )
  const projectMcpNames = createMemo(() => {
    const shared = new Set(globalMcpNames())
    return (data.location.mcp.server.list({ directory: directorySDK().directory }) ?? [])
      .map((server) => server.name)
      .filter((name) => !shared.has(name))
      .sort()
  })
  const mcpEnabled = (name: string) =>
    data.location.mcp.server.list({ directory: directorySDK().directory })?.find((server) => server.name === name)
      ?.status.status === "connected"

  const [globalPluginList] = createResource(
    () => serverSDK.connection.status() === "connected",
    () => serverSDK.api.plugin.list().then((result) => result.data),
    { initialValue: [] },
  )
  const [projectPluginList] = createResource(
    () => (serverSDK.connection.status() === "connected" ? directorySDK().directory : undefined),
    (directory) => serverSDK.api.plugin.list({ location: { directory } }).then((result) => result.data),
    { initialValue: [] },
  )
  const globalPlugins = createMemo(() => pluginLabels(globalPluginList.latest ?? []))
  const projectPlugins = createMemo(() => {
    const shared = new Set(globalPlugins())
    return pluginLabels(projectPluginList.latest ?? []).filter((name) => !shared.has(name))
  })

  const serverSkills = createMemo(() => data.location.skill.list() ?? [])
  const projectSkills = createMemo(() => {
    const shared = new Set(serverSkills().map(skillKey))
    return (data.location.skill.list({ directory: directorySDK().directory }) ?? []).filter(
      (item) => !shared.has(skillKey(item)),
    )
  })

  const mcpRows = (items: string[]) => (
    <For each={items}>
      {(name) => (
        <ExtensionRow icon="mcp" name={name}>
          <Switch
            checked={mcpEnabled(name)}
            disabled={toggleMcp.isPending && toggleMcp.variables === name}
            hideLabel
            onChange={() => {
              if (toggleMcp.isPending) return
              toggleMcp.mutate(name)
            }}
          >
            {name}
          </Switch>
        </ExtensionRow>
      )}
    </For>
  )

  const pluginRows = (items: string[]) => <For each={items}>{(name) => <ExtensionRow icon="cube" name={name} />}</For>

  const skillRows = (items: SkillItem[]) => (
    <For each={items}>{(item) => <ExtensionRow icon="post-skill" name={item.name} />}</For>
  )

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.extensions")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("project.settings.extensions.description")}
            </span>
          </div>
        </div>
      </div>

      <div class="settings-tab-body">
        <Tabs variant="pill" defaultValue="mcps" class="project-settings-extension-tabs settings-subtabs">
          <Tabs.List>
            <Tabs.Trigger value="mcps">{language.t("settings.extensions.tab.mcps")}</Tabs.Trigger>
            <Tabs.Trigger value="plugins">{language.t("status.popover.tab.plugins")}</Tabs.Trigger>
            <Tabs.Trigger value="skills">{language.t("settings.extensions.tab.skills")}</Tabs.Trigger>
            {/* TODO: Restore LSP status when V2 exposes it. */}
          </Tabs.List>

          <Tabs.Content value="mcps">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="mcps"
                empty={projectMcpNames().length === 0}
                action={<span>{language.t("settings.extensions.manageConfig")}</span>}
              />
              <Show when={projectMcpNames().length > 0}>
                <ExtensionCard>{mcpRows(projectMcpNames())}</ExtensionCard>
              </Show>
              <SharedSection count={globalMcpNames().length}>{mcpRows(globalMcpNames())}</SharedSection>
            </div>
          </Tabs.Content>

          <Tabs.Content value="plugins">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="plugins"
                empty={projectPlugins().length === 0}
                action={<span>{language.t("settings.extensions.manageConfig")}</span>}
              />
              <Show when={projectPlugins().length > 0}>
                <ExtensionCard>{pluginRows(projectPlugins())}</ExtensionCard>
              </Show>
              <SharedSection count={globalPlugins().length}>{pluginRows(globalPlugins())}</SharedSection>
            </div>
          </Tabs.Content>

          <Tabs.Content value="skills">
            <div class="project-settings-extension-section">
              <ProjectSectionHeader
                kind="skills"
                empty={projectSkills().length === 0}
                action={
                  <ExternalLink class="settings-extension-link" href="https://opencode.ai/docs/skills/">
                    {language.t("settings.extensions.addSkills")}
                  </ExternalLink>
                }
              />
              <Show when={projectSkills().length > 0}>
                <ExtensionCard>{skillRows(projectSkills())}</ExtensionCard>
              </Show>
              <SharedSection count={serverSkills().length}>{skillRows(serverSkills())}</SharedSection>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </>
  )
}
