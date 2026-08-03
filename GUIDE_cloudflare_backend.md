# Adding a Backend So Users Don't Need Their Own API Key

**What this guide does:** Right now, meowmorph.com asks every visitor to paste in their own
Anthropic API key (for photo color analysis) and OpenAI key (for the finished-cat preview
photo) before those features work. This guide replaces both with a tiny "middleman" service
(called a Cloudflare Worker) that holds YOUR two keys safely on a server. Visitors just click
the buttons and it works — no key box anywhere.

**What you'll need:**
- A free Cloudflare account
- Your Anthropic account (console.anthropic.com) and OpenAI account (platform.openai.com)
- About 30–45 minutes

**Cost:** Cloudflare is free at this scale (their free plan allows 100,000 requests per day —
you will never come close). You pay Anthropic and OpenAI only for the calls your visitors
make, and Part 1 shows you how to put a hard monthly cap on both so there are no surprises.

---

## The big picture (30 seconds)

**Before:**

```
Visitor's browser ──(visitor's own keys)──▶ Anthropic AI
                                        └──▶ OpenAI Images
```

**After:**

```
Visitor's browser ──▶ Your Cloudflare Worker ──(YOUR keys, kept secret)──┬──▶ Anthropic AI (/claude)
                                                                          └──▶ OpenAI Images (/openai-image)
```

The Worker (full code in `worker.js`, same folder as this guide) receives requests from the
website, attaches the right secret key, forwards to the right API, and sends the answer back.
It also refuses requests that don't come from meowmorph.com. This also fixes a second, separate
problem: OpenAI's API rejects direct browser calls outright (no CORS support), so the
finished-cat-photo feature literally cannot work without a backend like this one — it isn't
just a security upgrade for that part, it's a requirement.

---

## Part 1: Cap your spending on both providers

Do this first. It's your safety net for everything else. If you already have your two
keys ready (e.g. saved in a local `.env` file), you can skip straight to setting the spend
caps below and reuse those keys in Part 2c.

**Anthropic:**
1. Go to **console.anthropic.com** and sign in.
2. Open **Settings → Limits** (or "Billing / Usage limits") and set a **monthly spend
   limit** you're comfortable with — e.g. $10–$20. This is a hard ceiling: even if
   something goes wrong, you can never be charged more than this per month.
3. If you don't already have a dedicated key, go to **API Keys** → **Create Key**, name
   it `meowmorph-website`.

**OpenAI:**
1. Go to **platform.openai.com** and sign in.
2. Open **Settings → Limits** and set a **monthly budget** the same way.
3. If you don't already have a dedicated key, go to **API keys** → **Create new secret
   key**, name it `meowmorph-website`.

> **Why a separate key per site?** If one is ever abused, you can delete just that key
> without breaking anything else you use that provider for.

---

## Part 2: Cloudflare — create the Worker

You do all of this in the web browser. No coding tools to install.

### 2a. Create the Worker

1. Go to **dash.cloudflare.com** and sign up (free) or log in.
2. In the left sidebar, click **Workers & Pages**.
3. Click **Create** → **Create Worker** (choose the "Hello World" starter if asked).
4. Give it a name like `meowmorph-ai`. Cloudflare will give it an address like
   `meowmorph-ai.YOURNAME.workers.dev` — **write this address down**, you'll need it
   in Part 3.
5. Click **Deploy** to create it, then click **Edit code**.

### 2b. Paste in the code

Delete everything in the code editor and paste the entire contents of `worker.js`
(same folder as this guide), then click **Deploy**. It handles two routes —
`/claude` and `/openai-image` — so both features are covered by one Worker.

### 2c. Add both API keys as secrets

Keys do NOT go in the code (code can end up in screenshots, backups, git…).
Cloudflare has a special locked box for them:

1. From your Worker's page, open **Settings** → **Variables and Secrets**.
2. Click **Add**, choose type **Secret**. Name: `ANTHROPIC_API_KEY` (exactly like
   that, capitals and underscores). Value: your `sk-ant-...` key from Part 1.
3. Click **Add** again. Name: `OPENAI_API_KEY`. Value: your `sk-proj-...` (or `sk-...`)
   key from Part 1.
4. Save (and deploy if it asks). If you had copies of the keys saved anywhere
   temporary (notes app, clipboard), you can clear those now — they only need to
   live in Cloudflare's secret store and your own `.env` from here on.

### 2d. Quick sanity check

Open your Worker's address (`https://meowmorph-ai.YOURNAME.workers.dev`) in a browser tab.
You should see a small error message like `{"error":{"message":"This service only works
from meowmorph.com."}}` — that's **correct and good**. It means the Worker is running and
turning away anything that isn't your website.

---

## Part 3: Changes to index.html

Seven edits across both API calls: remove each key box, remove each "remember key" code
block, and point both calls at your new Worker. You (or your AI assistant) can find each
spot by searching for the text shown.

### Anthropic (Claude) side

### Edit 1 — Replace the API-key form with a simpler note

**Find** this block (search for `Anthropic API Key`):

```html
    <div class="hint">This calls the Claude API directly from your browser using your own API key (never sent anywhere else, kept in memory for this session only — check "remember" to also save it in this browser's local storage). The AI's <em>only</em> job is to look at the photos and describe coat colors and markings using your yarn palette — it never touches stitch counts or construction.</div>
    <div class="row" style="margin-top:14px;">
      <div style="flex:1;min-width:220px;">
        <label>Anthropic API Key</label>
        <input type="password" id="apiKey" placeholder="sk-ant-...">
      </div>
      <div style="width:220px;">
        <label>Model</label>
        <input type="text" id="apiModel" value="claude-sonnet-5">
      </div>
      <div style="align-self:flex-end;">
        <label style="display:inline-flex;align-items:center;gap:6px;text-transform:none;font-weight:400;"><input type="checkbox" id="rememberKey" style="width:auto;">remember key in this browser</label>
      </div>
    </div>
```

**Replace with:**

```html
    <div class="hint">The AI's <em>only</em> job is to look at the photos and describe coat colors and markings using your yarn palette — it never touches stitch counts or construction. Photos are sent securely to our AI service for analysis and are not stored.</div>
```

### Edit 2 — Remove the "remember key" code

**Find** this block (search for `syp_apikey`):

```js
if(localStorage.getItem("syp_apikey")){
  document.getElementById("apiKey").value = localStorage.getItem("syp_apikey");
  document.getElementById("rememberKey").checked = true;
}
document.getElementById("rememberKey").addEventListener("change", (e)=>{
  if(!e.target.checked) localStorage.removeItem("syp_apikey");
});
```

**Delete it entirely** (nothing goes in its place).

### Edit 3 — Point the AI call at your Worker

**Find** this block (search for `async function callClaude`):

```js
async function callClaude(){
  const key = document.getElementById("apiKey").value.trim();
  const model = document.getElementById("apiModel").value.trim() || "claude-sonnet-5";
  if(!key) throw new Error("Enter your API key first.");
  if(document.getElementById("rememberKey").checked) localStorage.setItem("syp_apikey", key);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-api-key": key,
      "anthropic-version":"2023-06-01",
      "anthropic-dangerous-direct-browser-access":"true"
    },
    body: JSON.stringify({ model, max_tokens: 2500, messages: conversation })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error(data.error?.message || resp.statusText);
  conversation.push({role:"assistant", content:data.content});
  return (data.content||[]).map(b=>b.text||"").join("\n");
}
```

**Replace with** (put YOUR Worker address from step 2a on the first line — used by
both API calls below, so add it once near the top of the `<script>` block):

```js
const WORKER_BASE = "https://meowmorph-ai.YOURNAME.workers.dev";

async function callClaude(){
  const resp = await fetch(WORKER_BASE + "/claude", {
    method:"POST",
    headers:{ "content-type":"application/json" },
    body: JSON.stringify({ messages: conversation })
  });
  const data = await resp.json();
  if(!resp.ok) throw new Error(data.error?.message || resp.statusText);
  conversation.push({role:"assistant", content:data.content});
  return (data.content||[]).map(b=>b.text||"").join("\n");
}
```

### Edit 4 — Small error-message cleanup

**Find** this line (search for `check API key`):

```js
    status.textContent = "Request failed: " + err.message + " (check API key and that this key allows browser access).";
```

**Replace with:**

```js
    status.textContent = "Request failed: " + err.message + " (please try again in a moment).";
```

### OpenAI (finished-cat photo) side

### Edit 5 — Remove the OpenAI API-key form

**Find** the `<label>OpenAI API Key</label>` block (row with the key input, model
field, and "remember key" checkbox) and delete the key input + remember-key checkbox,
keeping the model/quality fields. Replace the security-note hint above it with a
simple note that photos are processed server-side.

### Edit 6 — Remove the OpenAI "remember key" code

**Find** (search for `syp_openai_apikey`):

```js
if(localStorage.getItem("syp_openai_apikey")){
  document.getElementById("openaiApiKey").value = localStorage.getItem("syp_openai_apikey");
  document.getElementById("rememberOpenaiKey").checked = true;
}
document.getElementById("rememberOpenaiKey").addEventListener("change", (e)=>{
  if(!e.target.checked) localStorage.removeItem("syp_openai_apikey");
});
```

**Delete it entirely.**

### Edit 7 — Point the image call at your Worker

**Find** `callOpenAIImageAPI` and `validateImageGenerationInputs`. Remove the
`openaiApiKey` blocker check in `validateImageGenerationInputs`, and in
`callOpenAIImageAPI` remove the key lookup/localStorage line and the
`Authorization` header, then point the `fetch()` at
`WORKER_BASE + "/openai-image"` instead of `https://api.openai.com/v1/images/edits`.
The `FormData` body (model, prompt, quality, size, output_format, n, image[] files)
stays exactly the same — the Worker forwards it as-is and just adds the real key.

---

## Part 4: Test it

The Worker only accepts requests from `https://meowmorph.com`, so a copy of the page
opened straight from your computer (a `file://` address) will be politely refused.
Test on the live site:

1. Publish the updated `index.html` to the site (commit + push, same as usual).
2. Open **meowmorph.com**, upload a cat photo, click **Analyze Photos**.
3. You should get a marking report — with no API-key box anywhere.
4. Try a follow-up message in the chat too (it uses the same connection).
5. Paint the stitch maps, upload a gray reference photo, and try **Generate Finished
   Crochet Cat Photo** — should return an image with no OpenAI key box anywhere.

If it fails, the most common causes are:
- A typo in the `WORKER_BASE` address in Edit 3 — compare it letter-by-letter with the
  address on your Worker's page in Cloudflare.
- A secret name isn't exactly `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — check Part 2c.
- The image call still points at `api.openai.com` directly instead of
  `WORKER_BASE + "/openai-image"` — check Edit 7.

You can also watch requests arrive in real time: Worker page → **Logs** →
**Begin log stream**, then click Analyze on the site.

---

## What's protecting your money (honest version)

- **The spend caps (Part 1) are the real safety net.** Whatever else happens, Anthropic
  and OpenAI each stop charging at your limit — set both, not just one.
- **The Worker refuses other websites.** The origin check keeps the door closed to
  casual misuse. A determined programmer could fake it — which is why the spend caps
  matter — but for a small craft site this combination is plenty.
- **The Worker enforces the Claude model/length and forwards image requests as-is.**
  Nobody can ask your key for a more expensive model or huge text outputs by tampering
  with the page. (The image endpoint's cost is already bounded by the fixed size/quality
  fields the site sends.)
- **Keep an eye on it early on:** Anthropic console → Usage and OpenAI platform → Usage
  both show daily spend. Glance at both the first week or two.

If you ever DO see abuse: delete the relevant API key in that provider's console
(everything on that route stops instantly), make a new one, and update the matching
Cloudflare secret. That's the whole recovery procedure. A stronger door (Cloudflare
"Turnstile", a free invisible robot-check) can be added later — not worth the setup
complexity on day one.

---

## Later: selling this on Etsy

Nothing to build today, but this design grows into a paid service naturally: the Worker
is already the gatekeeper between visitors and the AI, so a payment gate is just one
more check inside it. The usual pattern for Etsy is **access codes** — when someone buys
the Etsy listing, they receive a one-time code; the website asks for the code and sends
it along with the photos; the Worker checks the code against a list before doing any AI
work. Cloudflare has a free little database ("Workers KV") that can hold the codes and
mark them used. That's a comfortable weekend project **on top of** what this guide
builds — nothing here would need to be thrown away.
