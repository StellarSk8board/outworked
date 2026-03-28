// ─── Webhook Server ───────────────────────────────────────────────
// Lightweight localhost-only HTTP server that accepts POST requests and
// routes them to the trigger engine as webhook trigger evaluations.
//
// Security note: the server binds exclusively to 127.0.0.1 so it is never
// reachable from the network — only from processes on the same machine.
//
// Endpoint: POST /trigger/:triggerId
//   Body:    optional JSON object (passed as context to the trigger prompt)
//   Returns: { ok: true, triggered: "<id>" }  on success
//            { error: "..." }                 on failure

const http = require("http");
const triggerEngine = require("./trigger-engine");
const verbose = process.env.VERBOSE_LOGGING === "true";

const TRIGGER_PATH_RE = /^\/trigger\/([a-zA-Z0-9_-]+)$/;

class WebhookServer {
  /**
   * @param {number} [port=7891]
   */
  constructor(port = 7891) {
    this.port = port;
    /** @type {http.Server | null} */
    this.server = null;
  }

  /**
   * Start the HTTP server. Safe to call multiple times — subsequent calls are
   * no-ops if the server is already running.
   */
  start() {
    if (this.server) return;

    this.server = http.createServer((req, res) => {
      // Only POST is accepted
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      // Validate URL shape
      const pathMatch = req.url.match(TRIGGER_PATH_RE);
      if (!pathMatch) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const triggerId = pathMatch[1];

      // Accumulate body chunks, then evaluate
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });

      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          // An empty or non-JSON body is fine — the trigger prompt may not need context
        }

        const fired = triggerEngine.evaluateWebhook(triggerId, parsed);

        if (fired) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, triggered: triggerId }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Trigger not found or disabled" }));
        }
      });

      req.on("error", (err) => {
        console.error(`[webhook] Request error: ${err.message}`);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request" }));
      });
    });

    // Bind only to loopback — never the public interface
    this.server.listen(this.port, "127.0.0.1", () => {
      verbose &&
        console.log(`[webhook] Listening on http://127.0.0.1:${this.port}`);
    });

    // Log port-in-use errors rather than crashing the app
    this.server.on("error", (err) => {
      console.error(`[webhook] Server error: ${err.message}`);
    });
  }

  /**
   * Gracefully shut down the HTTP server.
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = WebhookServer;
