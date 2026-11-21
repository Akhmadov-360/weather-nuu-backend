import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, ToolError, ToolRegistry } from "./registry.js";

const ctx = { now: new Date("2026-11-21T10:00:00Z") };

const echo = defineTool({
  name: "echo",
  description: "Repeats the text",
  schema: z.object({ text: z.string().min(1), times: z.number().int().min(1).max(3).default(1) }),
  handler: async ({ text, times }) => ({ said: Array(times).fill(text) }),
});

describe("ToolRegistry.specs", () => {
  it("describes arguments for the model from the Zod schema", () => {
    const [spec] = new ToolRegistry([echo]).specs();
    expect(spec!.name).toBe("echo");
    expect(spec!.description).toBe("Repeats the text");
    const params = spec!.parameters as { type: string; properties: Record<string, unknown>; required: string[] };
    expect(params.type).toBe("object");
    expect(Object.keys(params.properties).sort()).toEqual(["text", "times"]);
    expect(params.required).toEqual(["text"]);
    expect(params).not.toHaveProperty("$schema");
  });
});

describe("ToolRegistry.run", () => {
  const registry = new ToolRegistry([
    echo,
    defineTool({
      name: "refuses",
      description: "Always refuses with a message for the model",
      schema: z.object({}),
      handler: async () => {
        throw new ToolError("Period is longer than 31 days");
      },
    }),
    defineTool({
      name: "breaks",
      description: "Throws an unexpected error",
      schema: z.object({}),
      handler: async () => {
        throw new Error("connection string postgres://user:secret@db");
      },
    }),
  ]);

  it("runs a tool with valid arguments and returns its result as JSON text", async () => {
    const result = await registry.run("echo", { text: "hi", times: 2 }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual({ said: ["hi", "hi"] });
  });

  it("fills defaults from the schema", async () => {
    const result = await registry.run("echo", { text: "hi" }, ctx);
    expect(JSON.parse(result.content)).toEqual({ said: ["hi"] });
  });

  it("does not throw on an unknown tool: the model is told", async () => {
    const result = await registry.run("nope", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/unknown tool/i);
  });

  it("does not throw on arguments of the wrong type: the model is told which one", async () => {
    const result = await registry.run("echo", { text: 5 }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/text/);
  });

  it("passes a ToolError message to the model as it is", async () => {
    const result = await registry.run("refuses", {}, ctx);
    expect(result).toEqual({ ok: false, content: "Period is longer than 31 days" });
  });

  it("hides the text of an unexpected error from the model", async () => {
    const result = await registry.run("breaks", {}, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).not.toContain("secret");
    expect(result.content).toMatch(/failed/i);
  });
});
