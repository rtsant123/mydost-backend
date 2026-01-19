import { FastifyInstance } from "fastify";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>mydost</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; }
      h1 { margin-bottom: 8px; }
      form { display: flex; gap: 8px; }
      input { flex: 1; padding: 10px; font-size: 16px; }
      button { padding: 10px 14px; font-size: 16px; }
      #out { margin-top: 16px; white-space: pre-wrap; border: 1px solid #ddd; padding: 12px; min-height: 120px; }
      .muted { color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <h1>mydost</h1>
    <div class="muted">Simple chat console for /dost</div>
    <form id="form">
      <input id="q" placeholder="Type here..." autocomplete="off" />
      <button type="submit">Send</button>
    </form>
    <div id="out"></div>
    <script>
      const form = document.getElementById("form");
      const input = document.getElementById("q");
      const out = document.getElementById("out");
      let es;

      const extractText = (card) => {
        if (!card || !card.cards) return "No response.";
        const parts = [];
        for (const c of card.cards) {
          if (c.title) parts.push(c.title);
          if (c.content) parts.push(c.content);
          if (Array.isArray(c.bullets)) parts.push(...c.bullets);
        }
        return parts.filter(Boolean).join("\\n");
      };

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        out.textContent = "Thinking...";
        if (es) es.close();
        const url = "/api/chat/stream?q=" + encodeURIComponent(q) + "&topic=dost";
        es = new EventSource(url);
        es.onmessage = (evt) => {
          if (!evt.data) return;
          try {
            const payload = JSON.parse(evt.data);
            if (payload.done) {
              es.close();
              return;
            }
            const card = payload.card || payload;
            out.textContent = extractText(card);
          } catch (err) {
            // ignore malformed events
          }
        };
        es.onerror = () => {
          out.textContent = "Connection error.";
          if (es) es.close();
        };
      });
    </script>
  </body>
</html>`;

export const registerDostRoutes = (app: FastifyInstance) => {
  app.get("/dost", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send(html);
  });
};
