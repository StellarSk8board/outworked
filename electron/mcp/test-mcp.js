#!/usr/bin/env node
// Quick smoke test for the MCP server.
// Run: node electron/mcp/test-mcp.js
//
// Tests that the server is running and responds to tools/list and tools/call.

const http = require("http");

const PORT = 7823;
let passed = 0;
let failed = 0;

async function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: "/mcp",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          // SSE response: "event: message\ndata: {...}\n\n"
          const match = buf.match(/^data:\s*(.+)$/m);
          if (match) {
            resolve(JSON.parse(match[1]));
          } else {
            // Try plain JSON
            try { resolve(JSON.parse(buf)); } catch { resolve(buf); }
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failed++;
  }
}

async function run() {
  console.log(`\nTesting MCP server on http://127.0.0.1:${PORT}/mcp\n`);

  // 1. Initialize
  console.log("1. initialize");
  try {
    const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert("returns protocolVersion", res.result?.protocolVersion === "2024-11-05");
    assert("server name is outworked-skills", res.result?.serverInfo?.name === "outworked-skills");
  } catch (e) {
    console.log(`  ✗ Connection failed: ${e.message}`);
    console.log("  → Is the Outworked app running?");
    failed++;
    return;
  }

  // 2. tools/list
  console.log("2. tools/list");
  const listRes = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = listRes.result?.tools || [];
  const toolNames = tools.map((t) => t.name);
  assert(`returns tools (got ${tools.length})`, tools.length >= 8);
  assert("has remember", toolNames.includes("remember"));
  assert("has recall", toolNames.includes("recall"));
  assert("has send_message", toolNames.includes("send_message"));
  assert("has list_channels", toolNames.includes("list_channels"));
  assert("has schedule_task", toolNames.includes("schedule_task"));

  // 3. tools/call — remember + recall
  console.log("3. remember + recall");
  const remRes = await post({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "remember", arguments: { scope: "global", key: "__test__", value: "hello from test" } },
  });
  assert("remember returns text", remRes.result?.content?.[0]?.text?.includes("Remembered"));

  const recRes = await post({
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "recall", arguments: { scope: "global", query: "__test__" } },
  });
  assert("recall finds test memory", recRes.result?.content?.[0]?.text?.includes("hello from test"));

  // Cleanup
  await post({
    jsonrpc: "2.0", id: 5, method: "tools/call",
    params: { name: "forget", arguments: { scope: "global", key: "__test__" } },
  });

  // 4. tools/call — list_channels
  console.log("4. list_channels");
  const chRes = await post({
    jsonrpc: "2.0", id: 6, method: "tools/call",
    params: { name: "list_channels", arguments: {} },
  });
  assert("list_channels returns text", typeof chRes.result?.content?.[0]?.text === "string");

  // 5. Unknown tool
  console.log("5. unknown tool");
  const unkRes = await post({
    jsonrpc: "2.0", id: 7, method: "tools/call",
    params: { name: "nonexistent_tool", arguments: {} },
  });
  assert("unknown tool returns error text", unkRes.result?.content?.[0]?.text?.includes("Unknown tool"));

  // Summary
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("Test failed:", err.message);
  process.exit(1);
});
