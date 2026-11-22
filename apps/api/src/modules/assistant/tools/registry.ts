import { z } from "zod";
import { AppError, type AssistantCitation } from "@weather/contracts";
import type { ToolSpec } from "../providers/types.js";

export type ToolContext = {
  now: Date;
  /** A tool that used sources tells which, so that the answer can show them (the `citations` event). */
  onCitations?: (items: AssistantCitation[]) => void;
};

/** What a tool hands back to the model: the text it will read, and whether the call worked. */
export type ToolResult = { ok: boolean; content: string };

/** An error whose text is meant for the model ("period is longer than 31 days"): it is passed on as it is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export type Tool = {
  spec: ToolSpec;
  /** Never throws: bad arguments and failures come back as `{ ok: false, content }` for the model to read. */
  run(rawArgs: unknown, ctx: ToolContext): Promise<ToolResult>;
};

export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}): Tool {
  // The description of the arguments for the model is built from the schema, never written by hand.
  const { $schema: _ignored, ...parameters } = z.toJSONSchema(def.schema, { io: "input" }) as Record<string, unknown>;

  return {
    spec: { name: def.name, description: def.description, parameters },
    async run(rawArgs, ctx) {
      const parsed = def.schema.safeParse(rawArgs);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "arguments"}: ${i.message}`).join("; ");
        return { ok: false, content: `Invalid arguments: ${issues}` };
      }
      try {
        return { ok: true, content: JSON.stringify(await def.handler(parsed.data, ctx)) };
      } catch (error) {
        if (error instanceof ToolError || error instanceof AppError) return { ok: false, content: error.message };
        // An unexpected error may carry connection strings or SQL: the model only learns that it failed.
        return { ok: false, content: "The tool failed unexpectedly. Tell the user the data is not available right now." };
      }
    },
  };
}

export class ToolRegistry {
  private readonly byName: Map<string, Tool>;

  constructor(tools: Tool[]) {
    this.byName = new Map(tools.map((tool) => [tool.spec.name, tool]));
  }

  specs(): ToolSpec[] {
    return [...this.byName.values()].map((tool) => tool.spec);
  }

  async run(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.byName.get(name);
    if (!tool) return { ok: false, content: `Unknown tool "${name}".` };
    return tool.run(rawArgs, ctx);
  }
}
