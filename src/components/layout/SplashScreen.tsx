/**
 * Branded first-load splash: the M&M emblem with a sweeping gold ring.
 *
 * - Rendered as plain server HTML + CSS so it paints instantly, before JS loads.
 * - Shown once per browser session (an inline script hides it on later page loads).
 * - <SplashController /> fades it out as soon as the page has loaded
 *   (min ~1s so it reads as intentional, max 2.2s). A pure-CSS fallback removes it
 *   even if JavaScript never runs. Styles live in globals.css (".mm-splash").
 */

export const SPLASH_SEEN_KEY = "mm-splash-seen";

/**
 * Runs before first paint (no React needed):
 * - skip the splash if it was already shown this session;
 * - let a tap on the splash dismiss it instantly, even before hydration.
 */
const skipScript = `(function(){var d=document.documentElement;try{if(sessionStorage.getItem("${SPLASH_SEEN_KEY}")){d.classList.add("mm-splash-off");return}}catch(e){}
document.addEventListener("pointerdown",function h(e){var s=document.getElementById("mm-splash");if(!s||!s.contains(e.target))return;document.removeEventListener("pointerdown",h,true);d.classList.add("mm-splash-done");try{sessionStorage.setItem("${SPLASH_SEEN_KEY}","1")}catch(_){}setTimeout(function(){d.classList.add("mm-splash-off")},700)},true)})();`;

export function SplashScreen() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: skipScript }} />
      <div id="mm-splash" className="mm-splash" aria-hidden="true">
        <div className="mm-splash__inner">
          <div className="mm-splash__emblem">
            <span className="mm-splash__ring" />
            <span className="mm-splash__ring mm-splash__ring--outer" />
            {/* Plain <img> on purpose: it must load without waiting for React. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/logo-320.webp"
              width={128}
              height={128}
              alt=""
              fetchPriority="high"
              decoding="async"
              className="mm-splash__logo"
            />
          </div>
          <p className="mm-splash__word">
            <span className="mm-splash__mm">
              M<span className="mm-splash__amp">&amp;</span>M
            </span>
            <span className="mm-splash__collections">COLLECTIONS</span>
          </p>
          <span className="mm-splash__bar">
            <span />
          </span>
        </div>
      </div>
    </>
  );
}
