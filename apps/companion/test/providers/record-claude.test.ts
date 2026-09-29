import { describe, expect, test } from "vitest";
import { READ_ONLY_QUERY_OPTIONS } from "../../src/adapters/providers/claude.ts";
import { sessionUnknownQueryOptions, streamQueryOptions } from "./record-claude.ts";

describe("record-claude query options", () => {
  test("streamQueryOptions applies the same read-only tool policy as the production adapter", () => {
    const options = streamQueryOptions("/tmp/workspace");
    expect(options.settingSources).toEqual(READ_ONLY_QUERY_OPTIONS.settingSources);
    expect(options.tools).toEqual(READ_ONLY_QUERY_OPTIONS.tools);
    expect(options.disallowedTools).toEqual(READ_ONLY_QUERY_OPTIONS.disallowedTools);
    expect(options.allowedTools).toEqual(READ_ONLY_QUERY_OPTIONS.allowedTools);
    expect(options.permissionPrompts).toBe(READ_ONLY_QUERY_OPTIONS.permissionPrompts);
  });

  test("sessionUnknownQueryOptions applies the same read-only tool policy as the production adapter", () => {
    const options = sessionUnknownQueryOptions("/tmp/workspace");
    expect(options.settingSources).toEqual(READ_ONLY_QUERY_OPTIONS.settingSources);
    expect(options.tools).toEqual(READ_ONLY_QUERY_OPTIONS.tools);
    expect(options.disallowedTools).toEqual(READ_ONLY_QUERY_OPTIONS.disallowedTools);
    expect(options.allowedTools).toEqual(READ_ONLY_QUERY_OPTIONS.allowedTools);
    expect(options.permissionPrompts).toBe(READ_ONLY_QUERY_OPTIONS.permissionPrompts);
    expect(options.resume).toBe("00000000-0000-4000-8000-000000000000");
  });
});
