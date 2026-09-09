import type { BlockStatement, Expression, Node, Pattern } from "acorn"
import type { Effect } from "effect"
import type { DiagnosticKind } from "../codemode.js"
import type { SafeObject } from "../data.js"
import type { Values } from "../values.js"

/** Any parsed node; the interpreter narrows on `type` and reads `loc` for diagnostics. */
export type AstNode = Node

export type Binding = {
  mutable: boolean
  value: unknown
  initialized?: boolean
}

export type StatementResult =
  | { kind: "none" }
  | { kind: "return"; value: unknown }
  | { kind: "break"; label?: string }
  | { kind: "continue"; label?: string }

export type MemberReference = {
  target: SafeObject | Array<unknown> | Values.RegExp | Values.URL
  key: PropertyKey
}

export class CodeModeFunction {
  constructor(
    readonly parameters: ReadonlyArray<Pattern>,
    readonly body: BlockStatement | Expression,
    readonly capturedScopes: ReadonlyArray<Map<string, Binding>>,
    readonly async: boolean,
    readonly generator: boolean,
  ) {}
}

export type GeneratorRequestKind = "next" | "return" | "throw"

export class CodeModeGenerator {
  constructor(
    readonly asynchronous: boolean,
    readonly request: (
      kind: GeneratorRequestKind,
      value: unknown,
      node: AstNode,
    ) => Effect.Effect<unknown, unknown, unknown>,
  ) {}
}

export class GeneratorMethodReference {
  constructor(
    readonly generator: CodeModeGenerator,
    readonly kind: GeneratorRequestKind | "iterator",
  ) {}
}

export class IntrinsicReference {
  constructor(
    readonly receiver: unknown,
    readonly name: string,
  ) {}
}

export class ComputedValue {
  constructor(readonly value: unknown) {}
}

export const AsyncIteratorSymbol: unique symbol = Symbol("codemode.async-iterator")
export const IteratorSymbol: unique symbol = Symbol("codemode.iterator")
export const IteratorSymbols = [AsyncIteratorSymbol, IteratorSymbol] as const

export type PromiseInstanceMethodName = "then" | "catch" | "finally"

export class PromiseInstanceMethodReference {
  constructor(
    readonly promise: Values.Promise,
    readonly name: PromiseInstanceMethodName,
  ) {}
}

export class ProgramThrow {
  constructor(readonly value: unknown) {}
}

export class GeneratorReturn {
  constructor(readonly value: unknown) {}
}

export const OptionalShortCircuit: unique symbol = Symbol("codemode.optional-short-circuit")

// Keep this summary in sync with interpreter-support.md; test/new-expression.test.ts pins the constructor list.
export const supportedSyntaxMessage =
  "Supported syntax: tools.* calls (they return promises - resolve them with await), data literals, destructuring, optional chaining, template literals, conditionals, switch, loops (for, while, do...while, for...of, for await...of, and for...in over object/array/tools keys), labeled break/continue, function declarations, function expressions, arrow functions, async functions, generators, spread, try/catch/finally, and new for Object, Array, Promise, Date, RegExp, Map, Set, URL, URLSearchParams, and the Error types. Built-ins: Array, String, Number, Object, Math, JSON, Date, RegExp, Map, Set, URL, and URLSearchParams methods, URI encoding helpers, captured console.log/info/debug/warn/error/dir/table, Promise.all/allSettled/race/any/resolve/reject over collections mixing promises and plain values for parallel tool calls, and promise chaining with .then/.catch/.finally. Classes, this, getters/setters, tagged templates, BigInt, and arbitrary Symbols are not supported."

export class InterpreterRuntimeError extends Error {
  readonly node?: AstNode
  errorName = "Error"

  constructor(
    message: string,
    node?: AstNode,
    readonly kind: DiagnosticKind = "ExecutionFailure",
    readonly suggestions?: ReadonlyArray<string>,
  ) {
    super(message)
    this.name = "InterpreterRuntimeError"
    if (node) this.node = node
  }

  as(errorName: string): this {
    this.errorName = errorName
    return this
  }
}

export const unsupportedSyntax = (kind: string, node: AstNode): InterpreterRuntimeError =>
  new InterpreterRuntimeError(
    `Syntax '${kind}' is not supported. ${supportedSyntaxMessage}`,
    node,
    "UnsupportedSyntax",
    [supportedSyntaxMessage],
  )

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const sourceLocation = (node: AstNode): { readonly line: number; readonly column: number } => ({
  line: Math.max(1, (node.loc?.start.line ?? 2) - 1),
  column: Math.max(1, (node.loc?.start.column ?? 4) - 3),
})

export const formatLocation = (node?: AstNode): string => {
  if (!node?.loc) return ""
  const location = sourceLocation(node)
  return ` (line ${location.line}, col ${location.column})`
}
