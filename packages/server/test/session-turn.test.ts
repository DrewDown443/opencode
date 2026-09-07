import { expect, setDefaultTimeout } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { Bus } from "@opencode-ai/core/bus"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { Session } from "@opencode-ai/core/session"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Money } from "@opencode-ai/schema/money"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { Effect, Layer } from "effect"
import { tmpdir } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

setDefaultTimeout(30_000)

it.live("serves session turns and turn diffs with range validation", () =>
  Effect.gen(function* () {
    const tmp = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-session-turn-")))
    const state = { user: SessionMessage.ID.create(), assistant: SessionMessage.ID.create() }
    // Publish one complete busy period per prompt, the way the coordinator and runner would.
    const execution = Layer.effect(
      SessionExecution.Service,
      Effect.gen(function* () {
        const bus = yield* Bus.Service
        return SessionExecution.Service.of({
          active: Effect.succeed(new Set()),
          isActive: () => Effect.succeed(false),
          resume: () => Effect.void,
          wake: (sessionID) =>
            Effect.gen(function* () {
              yield* bus.publish(SessionEvent.Execution.Started, { sessionID })
              yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID: state.user })
              yield* bus.publish(SessionEvent.Step.Started, {
                sessionID,
                assistantMessageID: state.assistant,
                agent: Agent.defaultID,
                model: { id: Model.ID.make("model"), providerID: Provider.ID.make("provider") },
              })
              yield* bus.publish(SessionEvent.Step.Ended, {
                sessionID,
                assistantMessageID: state.assistant,
                finish: "stop",
                cost: Money.USD.zero,
                tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              })
              yield* bus.publish(SessionEvent.Execution.Succeeded, { sessionID })
            }),
          interrupt: () => Effect.succeed(false),
          awaitIdle: () => Effect.void,
        })
      }),
    )
    const handler = yield* ServerFetch.make(
      {
        app: { version: "test-version" },
        database: { path: ":memory:" },
        fs: { filewatcher: false },
        models: { fetch: false },
      },
      {
        overrides: [
          SessionExecution.node.replace(
            makeGlobalNode({ service: SessionExecution.Service, layer: execution, deps: [Bus.node] }),
          ),
        ],
      },
    )
    const get = (path: string) => Effect.promise(() => handler(new Request(`http://opencode.local${path}`)))
    const post = (path: string, body: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        ),
      )
    const json = (response: Response) => Effect.promise(() => response.json())
    const created = yield* post("/api/session", { location: { directory: tmp.path } }).pipe(Effect.flatMap(json))
    const sessionID = Session.ID.make(created.data.id)

    const empty = yield* get(`/api/session/${sessionID}/turn`)
    expect(empty.status).toBe(200)
    expect(yield* json(empty)).toEqual({ data: [] })
    const emptyDiff = yield* get(`/api/session/${sessionID}/diff`)
    expect(emptyDiff.status).toBe(200)
    expect(yield* json(emptyDiff)).toEqual({ data: [] })

    const prompted = yield* post(`/api/session/${sessionID}/prompt`, { id: state.user, text: "prompt" })
    expect(prompted.status).toBe(200)

    const turns = yield* get(`/api/session/${sessionID}/turn`)
    expect(turns.status).toBe(200)
    expect(yield* json(turns)).toEqual({
      data: [
        {
          ordinal: 1,
          status: "succeeded",
          time: { started: expect.any(Number), ended: expect.any(Number) },
          messages: { first: state.user, last: state.assistant },
          location: { directory: tmp.path },
          files: [],
        },
      ],
    })

    const diff = yield* get(`/api/session/${sessionID}/diff?from=1&to=1&context=3`)
    expect(diff.status).toBe(200)
    expect(yield* json(diff)).toEqual({ data: [] })

    const backwards = yield* get(`/api/session/${sessionID}/diff?from=2&to=1`)
    expect(backwards.status).toBe(400)
    expect(yield* json(backwards)).toMatchObject({ _tag: "InvalidRequestError", field: "from" })
    const missing = yield* get(`/api/session/${sessionID}/diff?to=2`)
    expect(missing.status).toBe(400)
    expect(yield* json(missing)).toMatchObject({ _tag: "InvalidRequestError", field: "to" })
    expect((yield* get(`/api/session/${sessionID}/diff?from=0`)).status).toBe(400)

    const unknown = Session.ID.create()
    expect((yield* get(`/api/session/${unknown}/turn`)).status).toBe(404)
    expect((yield* get(`/api/session/${unknown}/diff`)).status).toBe(404)
  }),
)
