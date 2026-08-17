// meowmorph-ai — Cloudflare Worker. Forwards AI requests from meowmorph.com
// to Anthropic and OpenAI, attaching the secret API keys server-side so
// visitors never need (or see) their own. Two routes:
//
//   POST /claude        -> Anthropic Messages API (photo color analysis)
//   POST /openai-image  -> OpenAI Images "edit" API (finished-cat photo)
//
// Deploy via the Cloudflare dashboard (Workers & Pages -> your worker ->
// Edit code -> paste this file's contents -> Deploy). Secrets are set
// separately under Settings -> Variables and Secrets: ANTHROPIC_API_KEY
// and OPENAI_API_KEY. See GUIDE_cloudflare_backend.md for the full walkthrough.

const ALLOWED_ORIGINS = [
  "https://meowmorph.com",
  "https://www.meowmorph.com",
];

// The website cannot change these — the Worker always enforces them.
const CLAUDE_MODEL = "claude-sonnet-5";
const CLAUDE_MAX_TOKENS = 4000;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const okOrigin = ALLOWED_ORIGINS.includes(origin);

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

    const { pathname } = new URL(request.url);

    if (pathname === "/claude") {
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
          model: CLAUDE_MODEL,
          max_tokens: CLAUDE_MAX_TOKENS,
          // Extended thinking is on by default for this model and was
          // silently eating the whole max_tokens budget on longer prompts
          // (thinking-only response, no text block, stop_reason "max_tokens")
          // -- this task is a straightforward visual-classification-to-JSON
          // call with no need for it, so turn it off rather than gamble on
          // a bigger budget outrunning it.
          thinking: { type: "disabled" },
          messages: body.messages,
        }),
      });

      return new Response(resp.body, {
        status: resp.status,
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    if (pathname === "/openai-image") {
      let incoming;
      try {
        incoming = await request.formData();
      } catch {
        return reject("Bad request.", 400);
      }

      // Rebuild the multipart body server-side (fields + image files) so
      // the visitor's browser never needs the OpenAI key.
      const outgoing = new FormData();
      for (const [key, value] of incoming.entries()) outgoing.append(key, value);

      const resp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY },
        body: outgoing,
      });

      const contentType = resp.headers.get("content-type") || "application/json";
      return new Response(resp.body, {
        status: resp.status,
        headers: { "content-type": contentType, ...corsHeaders },
      });
    }

    return reject("Unknown endpoint.", 404);
  },
};
