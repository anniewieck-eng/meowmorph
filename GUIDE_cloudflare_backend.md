# Adding a Backend So Users Don't Need Their Own API Key

**What this guide does:** Right now, meowmorph.com asks every visitor to paste in their own
Anthropic API key before the AI can look at their cat photos. This guide replaces that with a
tiny "middleman" service (called a Cloudflare Worker) that holds ONE API key — yours — safely
on a server. Visitors just click "Analyze Photos" and it works.

**What you'll need:**
- A free Cloudflare account
- Your Anthropic account (console.anthropic.com)
- About 30–45 minutes

**Cost:** Cloudflare is free at this scale (their free plan allows 100,000 requests per day —
you will never come close). You pay Anthropic only for the AI calls your visitors make, and
Part 1 shows you how to put a hard monthly cap on that so there are no surprises.

---

## The big picture (30 seconds)

**Before:**

```
Visitor's browser ──(visitor's own API key)──▶ Anthropic AI
```

**After:**

```
Visitor's browser ──▶ Your Cloudflare Worker ──(YOUR key, kept secret)──▶ Anthropic AI
```

The Worker is about 50 lines of code. It receives the photos and questions from the website,
attaches your API key (which visitors can never see), forwards everything to Anthropic, and
sends the answer back. It also refuses requests that don't come from meowmorph.com.

---

## Part 1: Anthropic — make a dedicated key and cap your spending

Do this first. It's your safety net for everything else.

1. Go to **console.anthropic.com** and sign in.
2. Open **Settings → Limits** (or "Billing / Usage limits" depending on the console layout)
   and set a **monthly spend limit** you're comfortable with — for example $10 or $20.
   This is a hard ceiling: even if something goes wrong, you can never be charged more
   than this per month.
3. Go to **API Keys** and click **Create Key**. Name it something like
   `meowmorph-website`. Copy the key (it starts with `sk-ant-`) somewhere safe for a
   few minutes — you'll paste it into Cloudflare in Part 2, then you can delete your copy.

> **Why a separate key?** If it's ever abused, you can delete just this key without
> breaking anything else you use Anthropic for.

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

Delete everything in the code editor and paste this entire block, then click **Deploy**:

```js
// meowmorph-ai — forwards AI requests from meowmorph.com to Anthropic,
// adding the secret API key so visitors never need their own.

const ALLOWED_ORIGINS = [
  "https://meowmorph.com",
  "https://www.meowmorph.com",
];

// The website cannot change these — the Worker always enforces them.
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2500;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.includes(origin);

    // Browsers send a quick "is this allowed?" check before the real request.
    const corsHeaders = {
      "Access-Control-Allow-Origin": okOrigin ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const reject = (message, status) =>
      new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { "content-type": "application/json", ...corsHeaders },
      });

    if (!okOrigin) return reject("This service only works from meowmorph.com.", 403);
    if (request.method !== "POST") return reject("POST only.", 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return reject("Bad request.", 400);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return reject("Bad request.", 400);
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: body.messages,
      }),
    });

    return new Response(resp.body, {
      status: resp.status,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  },
};
```

### 2c. Add your API key as a secret

The key does NOT go in the code (code can end up in screenshots, backups, git…).
Cloudflare has a special locked box for it:

1. From your Worker's page, open **Settings** → **Variables and Secrets**.
2. Click **Add**, choose type **Secret**.
3. Name: `ANTHROPIC_API_KEY` (exactly like that, capitals and underscores).
4. Value: paste your `sk-ant-...` key from Part 1.
5. Save (and deploy if it asks). You can now delete the copy of the key you saved earlier.

### 2d. Quick sanity check

Open your Worker's address (`https://meowmorph-ai.YOURNAME.workers.dev`) in a browser tab.
You should see a small error message like `{"error":{"message":"This service only works
from meowmorph.com."}}` — that's **correct and good**. It means the Worker is running and
turning away anything that isn't your website.

---

## Part 3: Changes to index.html

Three edits: remove the API-key box, remove the "remember key" code, and point the AI
call at your new Worker. You (or your AI assistant) can find each spot by searching for
the text shown.

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

**Replace with** (put YOUR Worker address from step 2a on the first line):

```js
const AI_ENDPOINT = "https://meowmorph-ai.YOURNAME.workers.dev";

async function callClaude(){
  const resp = await fetch(AI_ENDPOINT, {
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

---

## Part 4: Test it

The Worker only accepts requests from `https://meowmorph.com`, so a copy of the page
opened straight from your computer (a `file://` address) will be politely refused.
Test on the live site:

1. Publish the updated `index.html` to the site (commit + push, same as usual).
2. Open **meowmorph.com**, upload a cat photo, click **Analyze Photos**.
3. You should get a marking report — with no API-key box anywhere.
4. Try a follow-up message in the chat too (it uses the same connection).

If it fails, the two most common causes are:
- A typo in the `AI_ENDPOINT` address in Edit 3 — compare it letter-by-letter with the
  address on your Worker's page in Cloudflare.
- The secret name isn't exactly `ANTHROPIC_API_KEY` — check Part 2c.

You can also watch requests arrive in real time: Worker page → **Logs** →
**Begin log stream**, then click Analyze on the site.

---

## What's protecting your money (honest version)

- **The spend cap (Part 1) is the real safety net.** Whatever else happens, Anthropic
  stops charging at your limit.
- **The Worker refuses other websites.** The origin check keeps the door closed to
  casual misuse. A determined programmer could fake it — which is why the spend cap
  matters — but for a small craft site this combination is plenty.
- **The Worker enforces the model and answer length.** Nobody can ask your key for a
  more expensive model or huge outputs, even by tampering with the page.
- **Keep an eye on it early on:** Anthropic console → Usage shows your daily spend.
  Glance at it the first week or two.

If you ever DO see abuse: delete the API key in the Anthropic console (everything
stops instantly), make a new one, and update the Cloudflare secret. That's the whole
recovery procedure. A stronger door (Cloudflare "Turnstile", a free invisible
robot-check) can be added later — not worth the setup complexity on day one.

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
