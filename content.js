/*
 * Auto Reject Cookies - content.js
 *
 * This script is injected into every page (and every iframe) by the browser.
 * It never clicks "Accept". Its strategy, in order:
 *
 *   1. Known banners   : click the reject button of well-known consent
 *                        platforms by CSS selector (fast and precise).
 *   2. Generic banners : find anything that looks like a cookie banner and
 *                        click a button whose text says "Reject all", etc.
 *   3. Multi-step      : if only "Manage preferences" exists, open it, switch
 *                        every optional toggle OFF, then click "Save".
 *
 * Banners often appear late or are rebuilt by JavaScript, so we re-check
 * whenever the page changes (MutationObserver) for a limited time.
 */

(() => {
  "use strict";

  // Content scripts can run twice in the same frame; make sure we don't.
  if (window.__autoRejectCookiesLoaded) return;
  window.__autoRejectCookiesLoaded = true;

  // ---------------------------------------------------------------------
  // 1. DATA: what we look for
  // ---------------------------------------------------------------------

  // CSS selectors of reject buttons from popular consent platforms.
  // These can go stale when vendors change their markup: if a site stops
  // working, inspect the button and add its selector here.
  const KNOWN_REJECT_SELECTORS = [
    "#onetrust-reject-all-handler",                         // OneTrust
    ".ot-pc-refuse-all-handler",                            // OneTrust (preference centre)
    "#CybotCookiebotDialogBodyButtonDecline",               // Cookiebot
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#didomi-notice-disagree-button",                       // Didomi
    ".didomi-continue-without-agreeing",
    ".osano-cm-denyAll",                                    // Osano
    ".cc-deny",                                             // Cookie Consent (Osano/Insites)
    ".cmplz-deny",                                          // Complianz (WordPress)
    ".cky-btn-reject",                                      // CookieYes
    ".iubenda-cs-reject-btn",                               // Iubenda
    "#uc-btn-deny-banner",                                  // Usercentrics
    "[data-testid='uc-deny-all-button']",                   // Usercentrics (newer)
    ".sp_choice_type_REJECT_ALL",                           // Sourcepoint
    ".sp_choice_type_13",                                   // Sourcepoint (older id)
    ".fc-cta-do-not-consent",                               // Google Funding Choices
    "#truste-consent-required",                             // TrustArc
    ".qc-cmp2-summary-buttons button[mode='secondary']",    // Quantcast (often "Disagree")
  ];

  // Button texts that mean "reject". Written lowercase, no punctuation,
  // because we normalise the button text the same way before comparing.
  const REJECT_PHRASES = [
    // English
    "reject all", "reject all cookies", "reject", "reject non essential",
    "reject optional", "reject additional cookies", "reject and close",
    "decline", "decline all", "decline all cookies", "deny", "deny all",
    "refuse", "refuse all", "refuse all cookies", "only necessary",
    "only necessary cookies", "necessary cookies only", "only essential",
    "essential cookies only", "use necessary cookies only",
    "required only", "required cookies only", "only required",
    "only required cookies", "necessary only", "strictly necessary only",
    "strictly necessary cookies only", "essential only",
    "accept necessary only", "accept only necessary", "accept only essential",
    "continue without accepting", "disagree", "no thanks", "i do not accept",
    "i decline", "opt out", "do not consent", "object to all",
    // Spanish
    "rechazar todo", "rechazar todas", "rechazar", "solo necesarias",
    // French
    "tout refuser", "refuser tout", "refuser", "continuer sans accepter",
    // German
    "alle ablehnen", "ablehnen", "nur notwendige", "nur erforderliche",
    "nur essenzielle",
    // Italian
    "rifiuta tutto", "rifiuta tutti", "rifiuta",
    // Portuguese
    "rejeitar tudo", "rejeitar todos", "rejeitar", "recusar",
    // Dutch
    "alles weigeren", "weigeren", "alleen noodzakelijke",
  ];

  // Buttons that open the detailed settings (used only if no reject button).
  const SETTINGS_PHRASES = [
    "manage preferences", "manage cookies", "manage settings",
    "manage options", "manage my preferences", "cookie settings",
    "cookie preferences", "privacy settings", "customize", "customise",
    "preferences", "settings", "more options", "more choices", "options",
    "show purposes", "set cookie preferences",
    "configurar", "personalizar", "gerer", "personnaliser", "parametrer",
    "einstellungen", "verwalten", "anpassen", "impostazioni", "gestisci",
    "personalizza", "instellingen", "beheren",
  ];

  // Buttons that confirm the settings screen AFTER we switched toggles off.
  const SAVE_PHRASES = [
    "save", "save settings", "save preferences", "save and close",
    "save & exit", "save and exit", "confirm choices", "confirm my choices",
    "confirm selection", "allow selection", "submit", "submit preferences",
    "submit my preferences", "submit my choices", "confirm",
    "save my choices", "save my preferences", "confirm my selection",
    "allow selected", "accept selected", "guardar", "guardar configuracion",
    "enregistrer", "speichern", "salva", "opslaan",
  ];

  // Words in an element's id/class that suggest "this is a consent banner".
  const CONTAINER_KEYWORDS = [
    "cookie", "consent", "gdpr", "privacy", "cmp", "onetrust", "didomi",
    "cybot", "sp_message", "truste", "usercentrics", "osano", "iubenda",
    "termly", "cky", "cmplz", "qc-cmp", "evidon", "sd-cmp",
  ];

  // ---------------------------------------------------------------------
  // 2. SMALL HELPERS
  // ---------------------------------------------------------------------

  // "Reject All!" -> "reject all". Removes accents, punctuation, extra spaces.
  function normalize(text) {
    return text
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
      .replace(/[^\p{L}\p{N}\s&]/gu, " ")               // punctuation -> space
      .replace(/\s+/g, " ")
      .trim();
  }

  // Does this button text match one of the phrases?
  // We allow a few extra characters ("reject all cookies >") but cap the
  // length so a long paragraph can never match by accident.
  function matchesAny(label, phrases) {
    const n = normalize(label);
    if (!n || n.length > 60) return false;
    return phrases.some((p) => n === p || (n.startsWith(p) && n.length <= p.length + 20));
  }

  // The visible text of a button/link/input.
  function labelOf(el) {
    return (
      el.innerText || el.textContent || el.value ||
      el.getAttribute("aria-label") || el.title || ""
    );
  }

  // Is the element actually shown on screen?
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
           style.visibility !== "hidden" && style.display !== "none";
  }

  // Like querySelectorAll, but also looks inside "open" shadow DOMs, which
  // some consent platforms (e.g. Usercentrics) use to hide their buttons.
  function deepQueryAll(root, selector) {
    const results = Array.from(root.querySelectorAll(selector));
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) results.push(...deepQueryAll(el.shadowRoot, selector));
    }
    return results;
  }

  // All clickable things inside a container.
  function clickables(container) {
    // Some platforms (TrustArc included) use plain <div>/<span> as buttons,
    // so we also accept [onclick] and class names containing "button"/"btn".
    // The text matching later keeps this from clicking random things.
    return deepQueryAll(
      container,
      "button, a, [role='button'], input[type='button'], input[type='submit']," +
      "[onclick], [class*='button' i], [class*='btn' i]"
    ).filter(isVisible);
  }

  // ---------------------------------------------------------------------
  // 3. STATE: stop us from clicking forever
  // ---------------------------------------------------------------------

  const clicked = new WeakSet();  // elements we've already clicked
  const toggled = new WeakSet();  // toggles we've already switched off
  let totalClicks = 0;
  const MAX_CLICKS = 10;          // safety cap per page
  let settingsOpened = false;     // did we open a "manage preferences" screen?

console.log("[Auto Reject Cookies] Cookies rejected on " + location.hostname);

  function click(el) {
    if (clicked.has(el)) return false;
    clicked.add(el);
    totalClicks++;
    el.click();
    return true;
  }

  // ---------------------------------------------------------------------
  // 4. FINDING BANNERS
  // ---------------------------------------------------------------------

  // Build one big selector: [id*="cookie" i], [class*="cookie" i], ...
  const CONTAINER_SELECTOR = CONTAINER_KEYWORDS
    .flatMap((k) => [`[id*="${k}" i]`, `[class*="${k}" i]`])
    .join(",");

  const COOKIE_WORDS = /cookie|consent|gdpr|privacy|partners|vendors|tracking/i;

  function findContainers() {
    const found = deepQueryAll(document, CONTAINER_SELECTOR)
      .filter((el) => el !== document.body && el !== document.documentElement);

    // Generic dialogs only count if their text talks about cookies.
    for (const el of deepQueryAll(document, "[role='dialog'], [aria-modal='true']")) {
      if (COOKIE_WORDS.test(el.textContent || "")) found.push(el);
    }

    // Inside an iframe (e.g. Sourcepoint) the whole document IS the banner.
    if (window !== window.top && COOKIE_WORDS.test(document.body?.textContent || "")) {
      found.push(document.body);
    }
    return found;
  }

  // ---------------------------------------------------------------------
  // 5. SWITCHING OPTIONAL TOGGLES OFF (preference centres)
  // ---------------------------------------------------------------------

  // Returns how many toggles we switched off. Disabled toggles (usually
  // "strictly necessary") are left alone.
  const OFF_WORDS = ["off", "no", "disable", "disabled", "deny", "reject", "decline", "opt out"];

  function switchOffToggles(container) {
    let count = 0;

    // Checkboxes and switches: if ON and not locked, click to turn OFF.
    const toggles = deepQueryAll(
      container,
      "input[type='checkbox'], [role='switch'], [role='checkbox']"
    );
    for (const t of toggles) {
      if (toggled.has(t)) continue;
      const isOn = t.matches("input") ? t.checked : t.getAttribute("aria-checked") === "true";
      const disabled = t.disabled || t.getAttribute("aria-disabled") === "true";
      if (isOn && !disabled) {
        toggled.add(t);
        t.click();
        count++;
      }
    }

    // Radio buttons (e.g. "On / Off" per category): pick the "Off" option.
    for (const r of deepQueryAll(container, "input[type='radio']")) {
      if (toggled.has(r) || r.checked || r.disabled) continue;
      const text = (r.labels && r.labels[0] && r.labels[0].textContent) ||
                   r.getAttribute("aria-label") || r.value || "";
      if (OFF_WORDS.includes(normalize(text))) {
        toggled.add(r);
        r.click();
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------
  // 6. THE MAIN LOGIC: one pass = at most one action
  // ---------------------------------------------------------------------

  function tryReject() {
    if (totalClicks >= MAX_CLICKS) return;

    // Strategy 1: known platforms.
    for (const selector of KNOWN_REJECT_SELECTORS) {
      const el = deepQueryAll(document, selector).find(isVisible);
      if (el && click(el)) { schedule(500); return; }
    }

    // Strategy 2 and 3: generic banners.
    for (const container of findContainers()) {
      const buttons = clickables(container);

      // 2. A direct "Reject all" style button.
      const reject = buttons.find((b) => matchesAny(labelOf(b), REJECT_PHRASES));
      if (reject && click(reject)) { schedule(500); return; }

      // 3a. Preference screen: switch optional toggles off, then save/submit.
      // We detect this screen by what it contains (toggles + a save button)
      // instead of only trusting `settingsOpened`, because that flag is per
      // frame: the screen often lives in an iframe whose copy of this script
      // never saw the "Manage preferences" click made in the parent page.
      const save = buttons.find((b) => matchesAny(labelOf(b), SAVE_PHRASES));
      const hasToggles = deepQueryAll(
        container,
        "input[type='checkbox'], input[type='radio'], [role='switch'], [role='checkbox']"
      ).length > 0;
      if (settingsOpened || (hasToggles && save)) {
        const turnedOff = switchOffToggles(container);
        if (turnedOff > 0) { schedule(400); return; } // let the page update first
        if (save && click(save)) { schedule(500); return; }
      }

      // 3b. No reject button: open the settings screen.
      const settings = buttons.find((b) => matchesAny(labelOf(b), SETTINGS_PHRASES));
      if (settings && click(settings)) {
        settingsOpened = true;
        schedule(500);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 7. WHEN TO RUN
  // ---------------------------------------------------------------------

  let timer = null;
  function schedule(ms) {          // "debounce": many changes -> one run
    clearTimeout(timer);
    timer = setTimeout(tryReject, ms);
  }

  // Run now, and keep polling for 20 seconds (slow banners).
  tryReject();
  const poll = setInterval(tryReject, 500);
  setTimeout(() => clearInterval(poll), 20000);

  // Re-run when the page changes, but only for the first 60 seconds so we
  // don't slow down long-lived pages forever.
  const observer = new MutationObserver(() => schedule(300));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 60000);
})();
