/**
 * The model of the dust in a room (formula (3) of docs/features/SMART_ASSISTANT.md, link 2), mass balance:
 *   dC/dt = a·P·C_out − (a + k)·C_in + S/V
 * a: air exchange (1/h), P: share of particles that get in (0..1), k: deposition (1/h), S/V: a source in the room.
 * With C_out and S/V constant the solution goes exponentially to the equilibrium:
 *   C_in(t) = C_eq + (C_0 − C_eq)·e^{−(a+k)t},   C_eq = (a·P·C_out + S/V) / (a + k).
 * Time is in hours, concentrations in µg/m³.
 */

export type RoomParams = {
  /** Air exchange, 1/h. */
  a: number;
  /** Share of the outdoor particles that pass inside, 0..1. */
  p: number;
  /** Deposition, 1/h. */
  k: number;
  /** An internal source per unit of volume, µg/(m³·h). */
  source: number;
};

/** The speed of levelling off, λ = a + k, 1/h. The room forgets its past in about 1/λ hours. */
export function lambdaOf(params: Pick<RoomParams, "a" | "k">): number {
  return params.a + params.k;
}

/** The equilibrium C_eq that the concentration goes to. */
export function equilibrium(params: RoomParams, cOut: number): number {
  return (params.a * params.p * cOut + params.source) / (params.a + params.k);
}

/** The penetration coefficient η = a·P / (a + k): the share of the outdoor level that the room reaches when it has no source of its own. */
export function etaOf(params: Pick<RoomParams, "a" | "p" | "k">): number {
  return (params.a * params.p) / (params.a + params.k);
}

/** Concentration at time `t` (hours) from the start value `c0`, with the speed λ and the equilibrium `ceq`. */
export function relax(c0: number, ceq: number, lambda: number, t: number): number {
  return ceq + (c0 - ceq) * Math.exp(-lambda * t);
}

/** C_in(T) in the room with no source of its own and a constant outdoor level: η·C_out + (C_0 − η·C_out)·e^{−λT}. */
export function predictWithoutSource(c0: number, eta: number, lambda: number, cOut: number, hours: number): number {
  return relax(c0, eta * cOut, lambda, hours);
}

/** The time (hours) in which the distance to the equilibrium shrinks by half: ln 2 / λ. */
export function halfLifeHours(lambda: number): number {
  return Math.LN2 / lambda;
}
