const { createHash } = require("node:crypto");

const clearCallbackURL = 'history.replaceState(null, "", location.pathname);';
const scriptHash = createHash("sha256").update(clearCallbackURL).digest("base64");

const copy = {
  success: ["You're signed in", "You can close this tab and return to Freehire Interviews."],
  declined: ["Sign-in cancelled", "You can start again from Freehire Interviews."],
  failed: ["Sign-in couldn’t finish", "Return to Freehire Interviews to try again."],
  invalid: ["This sign-in link is invalid", "Start a new sign-in from Freehire Interviews."],
};

function sendOAuthPage(response, status, outcome) {
  const [title, description] = copy[outcome];
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${scriptHash}'; base-uri 'none'; frame-ancestors 'none'`,
  });
  response.end(`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Freehire Interviews</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f7;
    --surface: #fff;
    --text: #202124;
    --muted: #595b64;
    --line: #dedee4;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #27272d; --surface: #1e1e22; --text: #f4f4f6; --muted: #b8b9c1; --line: #414148; }
  }
  @media (prefers-contrast: more) {
    :root { --muted: var(--text); --line: var(--text); }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100svh;
    display: grid;
    place-items: center;
    padding: 1.25rem;
    background: var(--bg);
    color: var(--text);
    font: 1rem/1.55 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  }
  main {
    width: 100%;
    max-width: 28rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 1rem;
    padding: clamp(1.5rem, 7vw, 2.5rem);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: .3rem;
    margin-bottom: 1.25rem;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: -.035em;
  }
  .mark { width: 1.5rem; height: 1.5rem; fill: currentColor; }
  h1 { margin: 0; font-size: 1.75rem; line-height: 1.2; letter-spacing: -.035em; }
  p { margin: .65rem 0 0; color: var(--muted); }
</style>
<main>
  <div class="brand">
    <svg class="mark" viewBox="0 0 512 512" aria-hidden="true" fill="currentColor">
      <path fill-rule="evenodd" d="M256 56C366.457 56 456 145.543 456 256C456 366.457 366.457 456 256 456C145.543 456 56 366.457 56 256C56 145.543 145.543 56 256 56ZM256 166L346 256L256 346L166 256L256 166Z"/>
    </svg>
    <span>freehire</span>
  </div>
  <h1>${title}</h1>
  <p>${description}</p>
</main>
<script>${clearCallbackURL}</script>
</html>`);
}

module.exports = { sendOAuthPage };
