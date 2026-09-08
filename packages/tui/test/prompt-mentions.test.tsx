import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { directory, json } from "./fixture/tui-client"

test.each([44, 100])("mention labels keep skills and agents distinct at width %s", async (width) => {
  await using state = await tmpdir()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: "ses_mentions",
    title: "Mention fixture",
    projectID: "project",
    location: { directory },
    agent: "build",
    model: { providerID: "provider", id: "model" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const bodies: unknown[] = []
  await using setup = await createAppFixture({
    width,
    state: state.path,
    config: { animations: false, tabs: { enabled: false }, session: { sidebar: "hide" } },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/agent")
        return json({
          location,
          data: [
            { id: "build", mode: "primary", hidden: false, permissions: [] },
            { id: "review", mode: "subagent", hidden: false, permissions: [] },
          ],
        })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "provider", name: "Model", variants: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "provider", name: "Provider" }] })
      if (url.pathname === "/api/skill")
        return json({
          location,
          data: [
            {
              id: "review",
              name: "Review",
              description: "Review guidance with a deliberately long description that must not hide the type label",
            },
          ],
        })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/ses_mentions\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      if (url.pathname === `/api/session/${session.id}/prompt`) {
        bodies.push(await request.json())
        return new Response(null, { status: 204 })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Model"))
  setup.mockInput.pressKey("u", { ctrl: true })
  await setup.mockInput.typeText("@review")
  const frame = await setup.waitForFrame((frame) => frame.includes("Skill") && frame.includes("Agent"))
  const skill = frame.split("\n").find((line) => line.includes("Skill"))!
  expect(skill).toContain("@review")
  expect(skill).toContain("Review")
  expect(frame.split("\n").find((line) => line.includes("Agent"))).toContain("@review")
  if (frame.indexOf("Agent") < frame.indexOf("Skill")) setup.mockInput.pressArrow("down")
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => !frame.includes("Skill") && frame.includes("@review"))
  setup.mockInput.pressEnter()
  await setup.waitFor(() => bodies.length === 1)
  expect(bodies[0]).toMatchObject({
    text: "@review ",
    skills: [{ id: "review", mention: { text: "@review", start: 0, end: 7 } }],
  })
})
