import { expect, test } from "bun:test"
import { DateTime, Schema } from "effect"
import { AbsolutePath, RelativePath } from "../src/schema.js"
import { Session } from "../src/session.js"
import { SessionMessage } from "../src/session-message.js"
import { Status, Turn } from "../src/session-turn.js"

test("session turns keep stable identifiers and omit an absent end time", () => {
  expect(Session.Turn).toBe(Turn)
  expect(Turn.ast.annotations?.identifier).toBe("Session.Turn")
  expect(Status.ast.annotations?.identifier).toBe("Session.Turn.Status")

  const running = Turn.make({
    ordinal: 1,
    status: "running",
    time: { started: DateTime.makeUnsafe(1_000), ended: undefined },
    messages: { first: SessionMessage.ID.make("msg_first"), last: SessionMessage.ID.make("msg_last") },
    location: { directory: AbsolutePath.make("/project") },
    files: [RelativePath.make("src/index.ts")],
  })
  const encoded = Schema.encodeSync(Turn)(running)
  expect(encoded).toEqual({
    ordinal: 1,
    status: "running",
    time: { started: 1_000 },
    messages: { first: "msg_first", last: "msg_last" },
    location: { directory: "/project" },
    files: ["src/index.ts"],
  })
  expect(Schema.decodeUnknownSync(Turn)(encoded)).toEqual(running)
  expect(() => Schema.decodeUnknownSync(Turn)({ ...encoded, ordinal: 0 })).toThrow()
  expect(() => Schema.decodeUnknownSync(Turn)({ ...encoded, status: "queued" })).toThrow()
})
