import { z } from "zod";
import type { KnowledgeSearch } from "../../knowledge/service.js";
import { defineTool, type Tool } from "./registry.js";

/** At most this many characters of one fragment go to the model: a fragment is about 500 tokens. */
const MAX_TEXT = 2200;

/**
 * Search in the knowledge base: norms (WHO, US EPA), what the categories mean, what the sensors measure and their
 * limits, how to read the data. The model decides whether it needs it. The fragments found are reported as the
 * sources of the answer.
 */
export function createKnowledgeTool(search: KnowledgeSearch): Tool {
  return defineTool({
    name: "search_knowledge",
    description:
      "Search the knowledge base of the station: air quality norms (WHO 2021, US EPA AQI and its categories), what each sensor measures and its limits, the station itself, and general facts about dust and ventilation. Use it for questions of meaning and norms, not for current readings.",
    schema: z.object({
      query: z.string().min(2).max(300).describe("What to look for, as a short phrase"),
      lang: z.enum(["ru", "uz", "en"]).optional().describe("Limit the search to texts in this language; leave out to search all"),
    }),
    handler: async ({ query, lang }, ctx) => {
      const hits = await search(query, lang ? { lang, k: 3 } : { k: 3 });
      ctx.onCitations?.(hits.map(({ chunk }) => ({ id: chunk.id, title: chunk.title, source: chunk.source, ...(chunk.url ? { url: chunk.url } : {}) })));
      if (hits.length === 0) return { results: [], note: "Nothing found in the knowledge base for this query." };
      return {
        results: hits.map(({ chunk }) => ({
          id: chunk.id,
          source: chunk.source,
          title: chunk.title,
          language: chunk.lang,
          text: chunk.text.length > MAX_TEXT ? `${chunk.text.slice(0, MAX_TEXT)}...` : chunk.text,
        })),
        note: "Answer only from these fragments and name the source. If they do not answer the question, say so.",
      };
    },
  });
}
