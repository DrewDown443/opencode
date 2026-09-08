import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { Agent } from "@opencode/core/agent"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Plugin } from "@opencode/core/plugin"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Skill } from "@opencode/core/skill"
import { AbsolutePath } from "@opencode/core/schema"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const llm = TestLLM.testLayer()
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Session.node, SessionExecution.node, LocationServiceMap.node]), [
    Global.node.replace(tempGlobalLayer),
    offlineModels,
    LayerNodePlatform.llmClient.replace(llm),
    SessionRunnerModel.node.replace(
      Layer.succeed(SessionRunnerModel.Service, {
        resolve: () =>
          Effect.succeed(
            SessionRunnerModel.resolved(
              LanguageModel.make({ id: "fixture", provider: "test", route: OpenAIChat.route }),
              {
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                cost: [],
                limit: { context: 200_000, output: 32_000 },
              },
            ),
          ),
      }),
    ),
  ]).pipe(Layer.merge(llm)),
)

describe("Subagent skills", () => {
  it.live("loads an explicit skill before inference and a model-selected skill on the next step", () =>
    Effect.acquireRelease(
      Effect.promise(() => tmpdir()),
      (dir) => Effect.promise(() => dir[Symbol.asyncDispose]()),
    ).pipe(
      Effect.flatMap((dir) =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const execution = yield* SessionExecution.Service
          const locations = yield* LocationServiceMap.Service
          const model = yield* TestLLM.Test
          const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(dir.path) } })
          const child = yield* sessions.create({
            parentID: parent.id,
            agent: Agent.ID.make("reviewer"),
            title: "Skill fixture",
          })
          const info = Skill.Info.make({
            id: Skill.ID.make("fixture-guide"),
            name: Skill.Name.make("Fixture guide"),
            description: "Use this skill for the fixture review.",
            location: AbsolutePath.make(path.join(dir.path, "guide.md")),
            content: "Use the unique review marker SKILL_CONTENT_CANARY.",
          })
          yield* Effect.gen(function* () {
            const plugins = yield* Plugin.Service
            yield* plugins.awaitActivation
            const agents = yield* Agent.Service
            yield* agents.transform((editor) =>
              editor.update(Agent.ID.make("reviewer"), (agent) => {
                agent.mode = "subagent"
                agent.permissions.push({ action: "*", resource: "*", effect: "allow" })
              }),
            )
            const skills = yield* Skill.Service
            yield* skills.transform((editor) => editor.add(info))
          }).pipe(Effect.provide(locations.get(child.location)))

          yield* model.push(TestLLM.text("Explicit skill received", "explicit"))
          yield* sessions.prompt({
            sessionID: child.id,
            text: "Use @fixture-guide",
            skills: [{ id: info.id, mention: { start: 4, end: 18, text: "@fixture-guide" } }],
            resume: false,
          })
          yield* execution.resume(child.id)
          const explicit = yield* model.requests()
          expect(explicit).toHaveLength(1)
          expect(
            explicit[0].messages.some(
              (message) =>
                message.role === "user" &&
                message.content.some((part) => part.type === "text" && part.text.includes(info.content)),
            ),
          ).toBe(true)

          const other = yield* sessions.create({
            parentID: parent.id,
            agent: Agent.ID.make("reviewer"),
            title: "Tool skill fixture",
          })
          yield* model.push(
            TestLLM.tool("load-guide", "skill", { id: info.id }),
            TestLLM.text("Loaded skill received", "loaded"),
          )
          yield* sessions.prompt({ sessionID: other.id, text: "Review using the fixture guide", resume: false })
          yield* execution.resume(other.id)
          const requests = (yield* model.requests()).slice(explicit.length)
          expect(requests).toHaveLength(2)
          expect(requests[0].tools?.some((tool) => tool.name === "skill")).toBe(true)
          expect(JSON.stringify(requests[0].system)).toContain(info.id)
          expect(
            requests[0].messages.some((message) =>
              message.content.some((part) => part.type === "text" && part.text.includes(info.content)),
            ),
          ).toBe(false)
          expect(JSON.stringify(requests[1].messages.filter((message) => message.role === "tool"))).toContain(
            info.content,
          )
        }),
      ),
    ),
  )
})
