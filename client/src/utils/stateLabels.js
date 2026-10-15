/**
 * The NJ crawl is collected from a NY-geolocated IP, so the crawl "state" is
 * keyed internally as "NJ_NY" (matching the /NJ_NY/ data folder and file names)
 * and displayed to users as "NJ/NY".
 *
 * GPP strings are unaffected: the usnj section is still NJ.
 */

/** Display label for a crawl state code (e.g. "NJ_NY" -> "NJ/NY"). */
export function formatStateLabel(state) {
  return state === "NJ_NY" ? "NJ/NY" : state;
}

/** Crawl state code -> the GPP section state code used in tokens (usnj -> "NJ"). */
const CRAWL_STATE_TO_GPP_STATE = {
  NJ_NY: "NJ",
};

export function crawlStateToGppState(state) {
  return CRAWL_STATE_TO_GPP_STATE[state] ?? state;
}
