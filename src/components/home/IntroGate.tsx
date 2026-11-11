import { IntroAnimation } from "./IntroAnimation";

export const INTRO_SEEN_KEY = "mm-intro-seen";

/**
 * Runs before first paint, without React:
 * decides whether this full page load should play the brand intro.
 * - Only when the visitor lands on the homepage (deep links go straight to the page).
 * - Only once per browser session (later loads / refreshes skip it).
 * - Skipped for prefers-reduced-motion, or if sessionStorage is unavailable.
 * Playing is signalled with `html.mm-intro-play`; CSS shows the overlay only then,
 * so the server HTML is identical either way (no hydration mismatch, no flash).
 */
const decideScript = `(function(){var d=document.documentElement;if(location.pathname!=="/")return;try{if(sessionStorage.getItem("${INTRO_SEEN_KEY}"))return;sessionStorage.setItem("${INTRO_SEEN_KEY}","1")}catch(e){return}if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.classList.add("mm-intro-play")})();`;

/**
 * Server wrapper, mounted in the root layout (outside the page template) so the overlay
 * sits above the header from the very first paint. The decision script must come first.
 */
export function IntroGate() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: decideScript }} />
      <IntroAnimation />
    </>
  );
}
