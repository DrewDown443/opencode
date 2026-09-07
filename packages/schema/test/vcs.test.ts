import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Vcs } from "../src/vcs.js"

test("review base preserves its stable identity and local provenance", () => {
  expect(Vcs.Base.ast.annotations?.identifier).toBe("Vcs.Base")
  const base = { name: "release", ref: "refs/heads/release" }
  for (const source of ["reflog", "default"] as const) {
    expect(Schema.encodeSync(Vcs.Base)(Schema.decodeUnknownSync(Vcs.Base)({ ...base, source }))).toEqual({
      ...base,
      source,
    })
  }
  expect(() => Schema.decodeUnknownSync(Vcs.Base)({ ...base, source: "configured" })).toThrow()
  expect(() => Schema.decodeUnknownSync(Vcs.Base)({ ...base, source: "worktree" })).toThrow()
})

test("review modes preserve shipped working and combined branch names", () => {
  for (const mode of ["working", "branch", "committed"] as const) {
    expect(Schema.decodeUnknownSync(Vcs.Mode)(mode)).toBe(mode)
  }
  expect(() => Schema.decodeUnknownSync(Vcs.Mode)("unknown")).toThrow()
})

test("diff sources extend VCS modes with the session turn without widening backend modes", () => {
  expect(Vcs.DiffSource.ast.annotations?.identifier).toBe("Vcs.DiffSource")
  for (const source of ["working", "branch", "committed", "turn"] as const) {
    expect(Schema.decodeUnknownSync(Vcs.DiffSource)(source)).toBe(source)
  }
  expect(() => Schema.decodeUnknownSync(Vcs.DiffSource)("unknown")).toThrow()
  expect(() => Schema.decodeUnknownSync(Vcs.Mode)("turn")).toThrow()
})
