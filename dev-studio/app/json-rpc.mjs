// Framed stdio transport shared by LSP and DAP, with bounded requests.
export class FramedPeer {
  constructor(child, { dap = false, onEvent = () => {} } = {}) {
    this.child = child;
    this.dap = dap;
    this.id = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.onEvent = onEvent;
    child.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (true) {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const n = Number(
          /Content-Length:\s*(\d+)/i.exec(
            this.buffer.subarray(0, end).toString(),
          )?.[1],
        );
        if (!n || n > 10 * 1024 * 1024) {
          this.buffer = Buffer.alloc(0);
          break;
        }
        if (this.buffer.length < end + 4 + n) break;
        const bytes = this.buffer.subarray(end + 4, end + 4 + n);
        this.buffer = this.buffer.subarray(end + 4 + n);
        try {
          this.receive(JSON.parse(bytes));
        } catch {}
      }
    });
    const fail = () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.no(new Error("Language/debug process stopped."));
      }
      this.pending.clear();
    };
    child.on("exit", fail);
    child.on("error", fail);
  }
  send(message) {
    const text = JSON.stringify(message);
    this.child.stdin.write(
      `Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
    );
  }
  receive(message) {
    const key = this.dap ? message.request_seq : message.id,
      p = this.pending.get(key);
    if (p && (this.dap ? message.type === "response" : !message.method)) {
      clearTimeout(p.timer);
      this.pending.delete(key);
      message.error || message.success === false
        ? p.no(
            new Error(
              message.error?.message ||
                message.message ||
                "Protocol request failed",
            ),
          )
        : p.yes(this.dap ? message.body : message.result);
      return;
    }
    if (!this.dap && message.method && message.id !== undefined) {
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        result:
          message.method === "workspace/configuration"
            ? (message.params?.items || []).map(() => ({}))
            : null,
      });
      return;
    }
    this.onEvent(message);
  }
  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }
  request(method, params = {}, timeout = 8000) {
    const id = ++this.id;
    return new Promise((yes, no) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        no(new Error(`${method} timed out.`));
      }, timeout);
      this.pending.set(id, { yes, no, timer });
      this.send(
        this.dap
          ? { seq: id, type: "request", command: method, arguments: params }
          : { jsonrpc: "2.0", id, method, params },
      );
    });
  }
}
