import { describe, expect } from "bun:test"
import { Effect, Schedule, Schema } from "effect"
import { Bus } from "@opencode/core/bus"
import { Catalog } from "@opencode/core/catalog"
import { Config } from "@opencode/core/config"
import { ConfigProviderPlugin } from "@opencode/core/config/plugin/provider"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import {
  AmazonBedrockPlugin,
  AmazonBedrockModelsPlugin,
  PROFILE_ONLY_BARE_IDS,
} from "@opencode/core/plugin/provider/amazon-bedrock"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Document, Event, Info, type Entry } from "@opencode/schema/config"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

const addPlugin = (entries: Entry[] = []) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const host = yield* PluginHost.make(plugin)
    yield* AmazonBedrockPlugin.effect(host)
    yield* ConfigProviderPlugin.Plugin.effect(host)
    yield* AmazonBedrockModelsPlugin.effect(host)
  }).pipe(Effect.provide(Config.testLayer(entries)))

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value")
  return value
}

function withEnv<A, E, R>(vars: Record<string, string | undefined>, fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
      Object.entries(vars).forEach(([key, value]) => {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      })
      return previous
    }),
    fx,
    (previous) =>
      Effect.sync(() => {
        Object.entries(previous).forEach(([key, value]) => {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        })
      }),
  )
}

const noAmbientAWS = {
  AWS_PROFILE: undefined,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
  AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
  AWS_REGION: undefined,
  AWS_DEFAULT_REGION: undefined,
}

const seedBedrock = Effect.fn(function* (settings?: Record<string, unknown>) {
  const catalog = yield* Catalog.Service
  yield* catalog.transform((catalog) => {
    catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
      item.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
      if (settings) item.settings = settings
    })
  })
  return catalog
})

describe("AmazonBedrockPlugin", () => {
  it.effect("moves endpoint setting to baseURL", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ endpoint: "https://bedrock.example" })
        yield* addPlugin()
        const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
        expect(result.package).toBe(Provider.aisdk("@ai-sdk/amazon-bedrock"))
        expect(result.settings).toEqual({ baseURL: "https://bedrock.example", region: "us-east-1" })
      }),
    ),
  )

  it.effect("keeps an explicit baseURL over endpoint", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ baseURL: "https://base.example", endpoint: "https://endpoint.example" })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          baseURL: "https://base.example",
          region: "us-east-1",
        })
      }),
    ),
  )

  it.effect("only treats the bearer token env var as a key credential", () =>
    Effect.gen(function* () {
      const integrations = yield* Integration.Service
      const integrationID = Integration.ID.make(Provider.ID.amazonBedrock)
      yield* integrations.transform((editor) => {
        editor.method.update({ integrationID, method: { type: "key" } })
        editor.method.update({
          integrationID,
          method: {
            type: "env",
            names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_BEARER_TOKEN_BEDROCK"],
          },
        })
      })
      yield* addPlugin()
      expect((yield* integrations.get(integrationID))?.methods).toEqual([
        { type: "key" },
        { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      ])
    }),
  )

  it.effect("leaves activation on auto without ambient AWS configuration", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("auto")
      }),
    ),
  )

  for (const name of Object.keys(noAmbientAWS).filter((name) => !name.includes("REGION"))) {
    it.effect(`enables the provider when ${name} is set`, () =>
      withEnv({ ...noAmbientAWS, [name]: "value" }, () =>
        Effect.gen(function* () {
          const catalog = yield* seedBedrock()
          yield* addPlugin()
          expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("enabled")
        }),
      ),
    )
  }

  it.effect("enables the provider when a profile is configured", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ profile: "work" })
        yield* addPlugin()
        const result = required(yield* catalog.provider.get(Provider.ID.amazonBedrock))
        expect(result.activation).toBe("enabled")
        expect(result.settings).toEqual({ profile: "work", region: "us-east-1" })
      }),
    ),
  )

  it.effect("does not override a disabled provider", () =>
    withEnv({ ...noAmbientAWS, AWS_PROFILE: "work" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock")
            item.activation = "disabled"
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).activation).toBe("disabled")
      }),
    ),
  )

  it.effect("fills region from AWS_REGION then AWS_DEFAULT_REGION without overriding config", () =>
    withEnv({ ...noAmbientAWS, AWS_REGION: "eu-west-1", AWS_DEFAULT_REGION: "us-west-2" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "eu-west-1",
        })

        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.amazonBedrock, (item) => {
            item.settings = { region: "ap-southeast-2" }
          })
        })
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "ap-southeast-2",
        })
      }),
    ),
  )

  it.effect("falls back to AWS_DEFAULT_REGION then us-east-1", () =>
    withEnv({ ...noAmbientAWS, AWS_DEFAULT_REGION: "us-west-2" }, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings).toEqual({
          region: "us-west-2",
        })
        const fallback = yield* Effect.gen(function* () {
          yield* catalog.reload()
          return required(yield* catalog.provider.get(Provider.ID.amazonBedrock)).settings
        }).pipe((fx) => withEnv({ AWS_DEFAULT_REGION: undefined }, () => fx))
        expect(fallback).toEqual({ region: "us-east-1" })
      }),
    ),
  )

  it.effect("applies to Mantle and native Bedrock packages", () =>
    withEnv({ ...noAmbientAWS, AWS_PROFILE: "work" }, () =>
      Effect.gen(function* () {
        const catalog = yield* Catalog.Service
        yield* catalog.transform((catalog) => {
          catalog.provider.update(Provider.ID.make("mantle"), (item) => {
            item.package = Provider.aisdk("@ai-sdk/amazon-bedrock/mantle")
          })
          catalog.provider.update(Provider.ID.make("native"), (item) => {
            item.package = "@opencode/ai/providers/amazon-bedrock"
          })
          catalog.provider.update(Provider.ID.make("other"), (item) => {
            item.package = Provider.aisdk("@ai-sdk/anthropic")
          })
        })
        yield* addPlugin()
        expect(required(yield* catalog.provider.get(Provider.ID.make("mantle"))).activation).toBe("enabled")
        expect(required(yield* catalog.provider.get(Provider.ID.make("native"))).activation).toBe("enabled")
        expect(required(yield* catalog.provider.get(Provider.ID.make("other"))).activation).toBe("auto")
      }),
    ),
  )

  it.effect("disables profile-only bare IDs while keeping working IDs", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        const controls = [
          "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          "anthropic.claude-opus-4-6-v1",
          "anthropic.claude-sonnet-4-6",
          "amazon.nova-micro-v1:0",
          "openai.gpt-6-astra",
        ]
        yield* catalog.transform((catalog) => {
          for (const id of [...PROFILE_ONLY_BARE_IDS, ...controls]) {
            catalog.model.update(Provider.ID.amazonBedrock, Model.ID.make(id), () => {})
          }
        })
        yield* addPlugin()
        for (const id of PROFILE_ONLY_BARE_IDS) {
          expect(required(yield* catalog.model.get(Provider.ID.amazonBedrock, Model.ID.make(id))).enabled).toBe(false)
        }
        for (const id of controls) {
          expect(required(yield* catalog.model.get(Provider.ID.amazonBedrock, Model.ID.make(id))).enabled).toBe(true)
        }
      }),
    ),
  )

  it.effect("does not create catalog entries for absent profile-only IDs", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin()
        for (const id of PROFILE_ONLY_BARE_IDS) {
          expect(yield* catalog.model.get(Provider.ID.amazonBedrock, Model.ID.make(id))).toBeUndefined()
        }
      }),
    ),
  )

  it.effect("keeps the London in-region models available and selectable as defaults", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ region: "eu-west-2" })
        yield* catalog.transform((editor) => {
          for (const id of ["anthropic.claude-opus-4-6-v1", "anthropic.claude-sonnet-4-6"]) {
            editor.model.update(Provider.ID.amazonBedrock, Model.ID.make(id), () => {})
          }
        })
        yield* addPlugin([
          new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({
              model: { providerID: "amazon-bedrock", model: "anthropic.claude-sonnet-4-6" },
              providers: { "amazon-bedrock": {} },
            }),
          }),
        ])
        expect((yield* catalog.model.available()).map((model) => model.id)).toEqual(
          ["anthropic.claude-opus-4-6-v1", "anthropic.claude-sonnet-4-6"].map((id) => Model.ID.make(id)),
        )
        expect((yield* catalog.model.default())?.id).toBe(Model.ID.make("anthropic.claude-sonnet-4-6"))
      }),
    ),
  )

  it.effect("uses configured request IDs for availability and default selection", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        const profile = Model.ID.make("anthropic.claude-sonnet-4-5-20250929-v1:0")
        const application = Model.ID.make("anthropic.claude-opus-4-5-20251101-v1:0")
        const arn = "arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/example"
        yield* catalog.transform((editor) => {
          for (const id of [profile, application]) editor.model.update(Provider.ID.amazonBedrock, id, () => {})
        })
        yield* addPlugin([
          new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({
              model: { providerID: "amazon-bedrock", model: profile },
              providers: {
                "amazon-bedrock": {
                  models: {
                    [profile]: { modelID: `us.${profile}` },
                    [application]: { modelID: arn },
                    broken: { modelID: "deepseek.r1-v1:0" },
                  },
                },
              },
            }),
          }),
        ])
        expect((yield* catalog.model.available()).map((model) => model.id)).toEqual([profile, application])
        expect(yield* catalog.model.default()).toMatchObject({ id: profile, modelID: `us.${profile}` })
        expect(yield* catalog.model.get(Provider.ID.amazonBedrock, application)).toMatchObject({
          modelID: arn,
          enabled: true,
        })
      }),
    ),
  )

  it.effect("respects effective model packages on custom providers", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin([
          new Document({
            type: "document",
            info: Schema.decodeUnknownSync(Info)({
              providers: {
                custom: {
                  package: "@opencode/ai/providers/amazon-bedrock",
                  models: {
                    runtime: { modelID: "anthropic.claude-opus-5" },
                    sdk: { modelID: "deepseek.r1-v1:0", package: "aisdk:@ai-sdk/amazon-bedrock" },
                    mantle: {
                      modelID: "anthropic.claude-opus-5",
                      package: "@opencode/ai/providers/amazon-bedrock/mantle",
                    },
                    other: { modelID: "anthropic.claude-opus-5", package: "aisdk:@ai-sdk/anthropic" },
                  },
                },
              },
            }),
          }),
        ])
        expect((yield* catalog.model.available()).map((model) => model.id)).toEqual(
          ["mantle", "other"].map((id) => Model.ID.make(id)),
        )
      }),
    ),
  )

  it.effect("honors the latest explicit enable or disable setting", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock()
        yield* addPlugin(
          [true, false].map(
            (disabled) =>
              new Document({
                type: "document",
                info: Schema.decodeUnknownSync(Info)({
                  providers: {
                    "amazon-bedrock": {
                      models: {
                        enabled: { modelID: "deepseek.r1-v1:0", disabled },
                        disabled: { modelID: "deepseek.r1-v1:0", disabled: !disabled },
                        profile: { modelID: "us.deepseek.r1-v1:0", disabled: true },
                      },
                    },
                  },
                }),
              }),
          ),
        )
        expect((yield* catalog.model.available()).map((model) => model.id)).toEqual([Model.ID.make("enabled")])
      }),
    ),
  )

  it.live("refreshes availability when an explicit enable override changes", () =>
    withEnv(noAmbientAWS, () =>
      Effect.gen(function* () {
        const catalog = yield* seedBedrock({ profile: "test" })
        const config = yield* Config.Test
        const bus = yield* Bus.Service
        const plugin = yield* Plugin.Service
        const host = yield* PluginHost.make(plugin)
        const id = Model.ID.make("deepseek.r1-v1:0")
        yield* catalog.transform((editor) => editor.model.update(Provider.ID.amazonBedrock, id, () => {}))
        yield* AmazonBedrockPlugin.effect(host)
        yield* ConfigProviderPlugin.Plugin.effect(host)
        yield* AmazonBedrockModelsPlugin.effect(host)
        expect(yield* catalog.model.available()).toEqual([])

        for (const disabled of [false, undefined, true, false]) {
          yield* config.setEntries([
            new Document({
              type: "document",
              info: Schema.decodeUnknownSync(Info)({
                providers: { "amazon-bedrock": { models: { [id]: disabled === undefined ? {} : { disabled } } } },
              }),
            }),
          ])
          yield* bus.publish(Event.Updated, {})
          const models = yield* catalog.model.available().pipe(
            Effect.repeat({
              until: (models) => models.some((model) => model.id === id) === (disabled === false),
              times: 100,
              schedule: Schedule.spaced("1 millis"),
            }),
          )
          expect(models.some((model) => model.id === id)).toBe(disabled === false)
        }
      }).pipe(Effect.provide(Config.testLayer())),
    ),
  )
})
