/**
 * The value of λ_open (1/h) that is used while the readings of this room give too few reliable stretches.
 *
 * NOT YET BACKED BY A SOURCE. 5 per hour is a cautious engineering assumption for a room with a window open: the air
 * exchange of naturally ventilated classrooms is reported in the literature from a few to some tens of air changes per
 * hour depending on the opening, the wind and the temperature difference, and a low value makes the advice
 * conservative (it promises less from opening the window). Before this number goes into the thesis, a source has to be
 * read and cited. The candidate: Ferrari S., Blázquez T., Cardelli R., De Angelis E., Puglisi G., Escandón R., Suárez R.,
 * "Air change rates and infection risk in school environments: Monitoring naturally ventilated classrooms in a northern
 * Italian urban context", Heliyon 9(9):e19120, 2023, https://doi.org/10.1016/j.heliyon.2023.e19120 (the method there:
 * the decay of CO2 with a mass balance, as here; its results and Table 10 have not been read yet).
 * The advice marks every use of this value as "a literature estimate, not measured here".
 */
export const OPEN_WINDOW_LAMBDA_PRIOR = {
  value: 5,
  /** False until a source is read and checked: the interface and the log say so. */
  verified: false,
  candidateSource: "Ferrari et al., Heliyon 9(9):e19120 (2023), doi:10.1016/j.heliyon.2023.e19120",
} as const;
