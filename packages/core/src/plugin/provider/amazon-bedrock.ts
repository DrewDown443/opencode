import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Config } from "../../config.js"
import { ConfigEntryObserver } from "../../config/plugin/entry-observer.js"
import { Provider } from "../../provider.js"

// Ambient inputs the AWS default credential chain can turn into credentials
// without any key stored in opencode. Mirrors the presence checks the AWS CLI
// and SDK use before consulting shared config.
const CHAIN_ENV = [
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
]

const isBedrock = (item: { readonly package: string }) => {
  const name = Provider.packageName(item.package)
  return name.startsWith("@ai-sdk/amazon-bedrock") || name.startsWith("@opencode/ai/providers/amazon-bedrock")
}

// These bare IDs require inference profiles on Bedrock Runtime. V1 rewrites
// them, so models.dev retains them; V2 sends the request ID verbatim.
// Opus/Sonnet 4.6 are intentionally absent: AWS documents in-region Runtime
// support in eu-west-2. A regional failure does not justify a global exclusion.
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-4-6.html
export const PROFILE_ONLY_BARE_IDS = [
  "amazon.nova-2-lite-v1:0",
  "anthropic.claude-fable-5",
  "anthropic.claude-fable-5-1",
  "anthropic.claude-haiku-4-5-20251001-v1:0",
  "anthropic.claude-opus-4-1-20250805-v1:0",
  "anthropic.claude-opus-4-5-20251101-v1:0",
  "anthropic.claude-opus-4-7",
  "anthropic.claude-opus-4-8",
  "anthropic.claude-opus-5",
  "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "anthropic.claude-sonnet-5",
  "deepseek.r1-v1:0",
  "mistral.pixtral-large-2502-v1:0",
]

export const AmazonBedrockPlugin = define({
  id: "opencode.provider.amazon.bedrock",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      // models.dev advertises AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
      // AWS_REGION alongside the bearer token. Only the bearer token is a key;
      // the rest feed the SigV4 credential chain and must not become one.
      editor.method.update({
        integrationID: Provider.ID.amazonBedrock,
        method: { type: "env", names: ["AWS_BEARER_TOKEN_BEDROCK"] },
      })
    })
    yield* ctx.catalog.transform((evt) => {
      for (const item of evt.provider.list()) {
        if (!isBedrock(item.provider)) continue
        evt.provider.update(item.provider.id, (provider) => {
          const settings = provider.settings ?? {}
          const chain = typeof settings.profile === "string" || CHAIN_ENV.some((name) => process.env[name])
          // SigV4 authenticates through the AWS default chain rather than a key
          // credential, so ambient AWS configuration is what makes Bedrock usable.
          if (chain && provider.activation === "auto") provider.activation = "enabled"
          // Same default the native package uses, made explicit here so catalog
          // `${AWS_REGION}` URLs resolve without any region configured.
          const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1"
          provider.settings = {
            ...settings,
            ...(typeof settings.region !== "string" ? { region } : {}),
            // Users configure Bedrock private/VPC endpoints as `endpoint`; move it
            // into the catalog base URL once.
            ...(typeof settings.baseURL !== "string" && typeof settings.endpoint === "string"
              ? { baseURL: settings.endpoint }
              : {}),
          }
          delete provider.settings.endpoint
        })
      }
    })
  }),
})

// Runs after ConfigProviderPlugin so aliases, profile ARNs and package
// overrides have their final request identity before availability is decided.
export const AmazonBedrockModelsPlugin = define({
  id: "opencode.provider.amazon.bedrock.models",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loaded = yield* ConfigEntryObserver.observe(config, ctx.event, ctx.catalog.reload())
    yield* ctx.catalog.transform((catalog) => {
      for (const record of catalog.provider.list()) {
        for (const model of record.models.values()) {
          if (!model.enabled || !PROFILE_ONLY_BARE_IDS.includes(model.modelID ?? model.id)) continue
          const pkg = Provider.packageName(model.package ?? record.provider.package)
          if (pkg !== "@ai-sdk/amazon-bedrock" && pkg !== "@opencode/ai/providers/amazon-bedrock") continue
          const disabled = loaded.entries
            .flatMap((entry) =>
              entry.type === "document"
                ? (entry.info.providers?.[record.provider.id]?.models?.[model.id]?.disabled ?? [])
                : [],
            )
            .at(-1)
          // Explicit configuration can opt back into a catalog default we hide.
          if (disabled === false) continue
          catalog.model.update(record.provider.id, model.id, (draft) => {
            draft.enabled = false
          })
        }
      }
    })
  }),
})
