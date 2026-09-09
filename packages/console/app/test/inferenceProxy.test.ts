import { afterAll, expect, mock, spyOn, test } from "bun:test"
import { prepareRequestBody } from "../src/routes/zen/util/requestBody"

const requests: Array<{ path: string; headers: Headers; body: string }> = []
let status = 200
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    requests.push({ path: url.pathname + url.search, headers: request.headers, body: await request.text() })
    return new Response("data: hello\n\ndata: [DONE]\n\n", {
      status,
      headers: { "content-type": "text/event-stream", "retry-after": "60" },
    })
  },
})
mock.module("@opencode-ai/console-resource", () => ({
  Resource: { ConsoleMigration: { inferenceUrl: `${server.url}inference` } },
  waitUntil: (promise: Promise<unknown>) => promise,
}))
const { Database } = await import("@opencode-ai/console-core/drizzle/index.js")
const { proxyInference, inferenceUnavailable } = await import("../src/lib/inference-proxy")
const lookup = spyOn(Database, "use")
afterAll(() => {
  lookup.mockRestore()
  server.stop(true)
})

test("migrated Go uses original credentials, replayed bodies and ordinary destination authentication", async () => {
  for (const [source, target, credential] of [
    ["chat/completions", "openai/v1/chat/completions", "authorization"],
    ["responses", "openai/v1/responses", "authorization"],
    ["messages", "anthropic/v1/messages", "x-api-key"],
  ] as const) {
    lookup.mockResolvedValue({ id: "wrk_migrated", migratedAt: new Date(), provider: null })
    const key = `sk-${"a".repeat(64)}`
    const request = new Request(`https://opencode.ai/zen/go/v1/${source}?trace=1`, {
      method: "POST",
      headers: {
        [credential]: credential === "authorization" ? `Bearer ${key}` : key,
        "x-opencode-session": "session-go",
        "x-opencode-request": "request-go",
        "cf-connecting-ip": "192.0.2.5",
        "cf-ipcountry": "FR",
        "x-zen": "true",
        "x-zen-model": "override",
        "cf-access-client-secret": "must-not-forward",
      },
      body: '{"messages":[{"content":"large prompt"}],"model":"public-go","stream":true}',
    })
    const prepared = await prepareRequestBody(request.body!)
    const response = await proxyInference(request, { body: () => prepared.stream(prepared.model, false) })
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe("data: hello\n\ndata: [DONE]\n\n")
    const sent = requests.at(-1)!
    expect(sent.path).toBe(`/inference/go/${target}?trace=1`)
    expect(sent.headers.get("authorization")).toBe(`Bearer ${key}`)
    expect(sent.headers.get("x-opencode-session")).toBe("session-go")
    expect(sent.headers.get("x-opencode-request-id")).toBe("request-go")
    expect(sent.headers.get("x-real-ip")).toBe("192.0.2.5")
    expect(sent.headers.get("cf-ipcountry")).toBe("FR")
    expect(sent.headers.get("x-zen")).toBeNull()
    expect(sent.headers.get("x-zen-model")).toBeNull()
    expect(sent.headers.get("cf-access-client-secret")).toBeNull()
    expect(JSON.parse(sent.body)).toEqual({ messages: [{ content: "large prompt" }], model: "public-go", stream: true })
  }
})

test("native keys route generation and reads without a legacy database lookup", async () => {
  lookup.mockRejectedValue(new Error("Native keys must not query legacy storage"))
  const key = `oc_sk_${"a".repeat(12)}_${"-_".repeat(16)}`
  for (const operation of ["models", "usage", "messages"]) {
    const generation = operation === "messages"
    const request = new Request(`https://opencode.ai/zen/go/v1/${operation}`, {
      method: generation ? "POST" : "GET",
      headers: generation ? { "x-api-key": key } : { authorization: `Bearer ${key}` },
      ...(generation ? { body: '{"model":"public-go"}' } : {}),
    })
    const response = await proxyInference(request, generation ? { body: () => request.body! } : undefined)
    expect(response?.status).toBe(200)
    await response?.body?.cancel()
    expect(requests.at(-1)?.path).toBe(`/inference/go/${generation ? "anthropic/v1/messages" : `v1/${operation}`}`)
  }
})

test("unmigrated, unknown, missing and public keys keep legacy handling", async () => {
  const before = requests.length
  for (const workspace of [undefined, { id: "wrk_old", migratedAt: null, provider: null }]) {
    lookup.mockResolvedValue(workspace)
    for (const key of [undefined, "public", `sk-${"b".repeat(64)}`]) {
      const request = new Request("https://opencode.ai/zen/go/v1/usage", {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      })
      expect(await proxyInference(request)).toBeUndefined()
    }
  }
  expect(requests).toHaveLength(before)
})

test("destination denial and routing failures never become legacy fallback", async () => {
  lookup.mockResolvedValue({ id: "wrk_migrated", migratedAt: new Date(), provider: null })
  const request = () =>
    new Request("https://opencode.ai/zen/go/v1/usage", { headers: { authorization: "Bearer old-key" } })
  for (const denied of [401, 403, 429, 503]) {
    status = denied
    const response = await proxyInference(request())
    expect(response?.status).toBe(denied)
    expect(response?.headers.get("retry-after")).toBe("60")
    await response?.body?.cancel()
  }
  status = 200
  lookup.mockRejectedValueOnce(new Error("database unavailable"))
  const response = await proxyInference(request()).catch(inferenceUnavailable)
  expect(response?.status).toBe(503)
  expect(response?.headers.get("cache-control")).toBe("no-store")
})

test("Zen retains hosted and imported BYOK routing", async () => {
  for (const provider of [null, "openai"]) {
    lookup.mockResolvedValue({ id: "wrk_migrated", migratedAt: new Date(), provider })
    const request = new Request("https://opencode.ai/zen/v1/responses", {
      method: "POST",
      headers: { authorization: "Bearer zen-key" },
      body: '{"model":"zen-alias"}',
    })
    const prepared = await prepareRequestBody(request.body!)
    const response = await proxyInference(request, {
      provider: "openai",
      model: "native-model",
      body: (model) => prepared.stream(model ?? prepared.model, false),
    })
    await response?.body?.cancel()
    expect(requests.at(-1)?.path).toBe(
      provider ? "/inference/custom/conn_migrated_openai/responses" : "/inference/openai/v1/responses",
    )
    expect(JSON.parse(requests.at(-1)!.body).model).toBe(provider ? "native-model" : "zen-alias")
  }
})
