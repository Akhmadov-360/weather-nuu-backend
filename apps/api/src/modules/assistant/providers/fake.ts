import type { ChatProvider, GenerateInput, ProviderChunk } from "./types.js";

/** A scripted turn: the chunks to stream, or an error to throw. */
export type FakeTurn = ProviderChunk[] | Error;

/**
 * A model that plays a script, one turn per `generate` call. Used by tests and by the development
 * server (`ASSISTANT_PROVIDER=fake`); the server refuses to start with it in production.
 */
export class FakeChatProvider implements ChatProvider {
  /** Every call it received, for assertions. */
  readonly calls: GenerateInput[] = [];
  private next = 0;

  constructor(private readonly script: FakeTurn[]) {}

  async *generate(input: GenerateInput): AsyncGenerator<ProviderChunk> {
    this.calls.push(input);
    const turn = this.script[this.next++];
    if (turn === undefined) throw new Error("FakeChatProvider script has run out");
    if (turn instanceof Error) throw turn;
    for (const chunk of turn) {
      if (input.signal.aborted) return;
      yield chunk;
    }
  }
}
