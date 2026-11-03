import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { craftbotUrl, craftbotState, craftbotAgent, craftbotSocket, stopCraftbotSession } from "../app/craftbot-connection.mjs";

test("CraftBot endpoints stay local and never follow redirects", async () => {
  for (const url of ["https://localhost:7926", "http://example.com", "http://localhost@remote.test", "http://localhost/a", "http://localhost/?token=secret", "http://localhost/#fragment"])
    assert.throws(() => craftbotUrl(url));
  assert.equal(craftbotUrl("http://127.0.0.1:7926/"), "http://127.0.0.1:7926");
  const server = createServer((_req, res) => { res.writeHead(302, {location:"http://example.com"}); res.end(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await assert.rejects(() => craftbotState("http://127.0.0.1:" + server.address().port)); }
  finally { await new Promise(resolve => server.close(resolve)); }
});

test("existing authenticated transport stops only an explicitly owned chat and strips private state", async () => {
  const session = "abcdef123456", sent = [], protocols = [];
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url === "/api/session-token" ? {token:"private-fixture-token"} :
      {version:"fixture",sessions:[{id:session,title:"private-title"},{id:"main"}],busySessions:[],messages:["private-transcript"]}));
  });
  const ws = new WebSocketServer({server});
  ws.on("connection", (socket, req) => {
    protocols.push(req.headers["sec-websocket-protocol"]);
    socket.on("message", raw => {
      const message = JSON.parse(raw); sent.push(message);
      socket.send(JSON.stringify({type:"session_busy",data:{sessionId:"main",state:"idle",busy:false}}));
      setTimeout(() => socket.send(JSON.stringify({type:"session_busy",data:{sessionId:session,state:"idle",busy:false}})), 15);
    });
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    const state = await craftbotState(url);
    assert.doesNotMatch(JSON.stringify(state), /private-/);
    assert.equal((await craftbotAgent(url)).available, true);
    await assert.rejects(() => stopCraftbotSession({provider:"craftbot",url,clientId:"studio-fixture",session:"main"}), /ownership/);
    await assert.rejects(() => stopCraftbotSession({provider:"other",url,clientId:"studio-fixture",session}), /ownership/);
    assert.equal(await stopCraftbotSession({provider:"craftbot",url,clientId:"studio-fixture",session}), true);
    assert.deepEqual(sent, [{type:"session_stop",sessionId:session}]);
    assert.match(protocols[0], /craftbot-auth.private-fixture-token/);
  } finally { for (const socket of ws.clients) socket.terminate(); await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => server.close(resolve)); }
});
