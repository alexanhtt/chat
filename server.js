const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234567890";

let adminClients = [];
let userClients = {};
let messages = {};

function sendToTelegramIfNoAdmin(msg) {
  if (adminClients.length > 0) return; // Có admin đang online → bỏ qua

  const data = JSON.stringify({ chat_id: "8202619534", text: msg });
  const opts = {
    hostname: "api.telegram.org",
    path: `/bot8373261372:AAFqkJGHkynpySa3kKa4Uews3WXrCjtRnaY/sendMessage`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(data)
    }
  };
  const req = https.request(opts, res => res.on("data", () => {}));
  req.on("error", e => console.error("Telegram error:", e));
  req.write(data);
  req.end();
}

function serve(res, file, type = "text/html") {
  fs.readFile(path.join(__dirname, file), (err, data) => {
    if (err) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": type }).end(data);
  });
}

function send(clients, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => c.write(msg));
}

http.createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/index.html")) return serve(res, "index.html");
  if (req.url.startsWith("/style.css")) return serve(res, "style.css", "text/css");
  if (req.url.startsWith("/client.js")) return serve(res, "client.js", "application/javascript");

  // --- SSE ---
  if (req.url.startsWith("/events")) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const role = url.searchParams.get("role");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    if (role === "user") {
      const id = url.searchParams.get("client_id");
      (userClients[id] ||= []).push(res);
      req.on("close", () => userClients[id] = userClients[id].filter(c => c !== res));
    } else if (role === "admin") {
      const token = url.searchParams.get("token");
      if (token) {
        adminClients.push(res);
        req.on("close", () => adminClients = adminClients.filter(c => c !== res));
      }
    }
    return;
  }

  // --- APIs ---
  if (req.url.startsWith("/message") && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const { role, client_id, user_id, message } = JSON.parse(body || "{}");
      const ts = new Date().toLocaleTimeString();

      if (role === "user") {
        (messages[client_id] ||= []).push({ sender: "user", ts, message });
        send(userClients[client_id] || [], "message", { sender: "user", ts, message });
        send(adminClients, "message", { sender: "user", ts, message, user_id: client_id });
        // 🚀 chỉ gửi Telegram nếu không có admin online
        sendToTelegramIfNoAdmin(`User ${client_id} (${ts}): ${message}`);
      }
      if (role === "admin") {
        (messages[user_id] ||= []).push({ sender: "admin", ts, message });
        send(adminClients, "message", { sender: "admin", ts, message, user_id });
        send(userClients[user_id] || [], "message", { sender: "admin", ts, message });
      }

      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (req.url.startsWith("/user/history")) {
    const id = new URL(req.url, `http://${req.headers.host}`).searchParams.get("client_id");
    res.writeHead(200, { "Content-Type": "application/json" })
       .end(JSON.stringify({ ok: true, history: messages[id] || [] }));
    return;
  }

  if (req.url.startsWith("/admin-login") && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      const { password } = JSON.parse(body || "{}");
      if (password === ADMIN_PASSWORD) {
        res.writeHead(200, { "Content-Type": "application/json" })
           .end(JSON.stringify({ ok: true, token: crypto.randomUUID() }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" })
           .end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (req.url.startsWith("/admin/users")) {
    res.writeHead(200, { "Content-Type": "application/json" })
       .end(JSON.stringify({ ok: true, users: Object.keys(messages) }));
    return;
  }

  if (req.url.startsWith("/admin/history")) {
    const id = new URL(req.url, `http://${req.headers.host}`).searchParams.get("user_id");
    res.writeHead(200, { "Content-Type": "application/json" })
       .end(JSON.stringify({ ok: true, history: messages[id] || [] }));
    return;
  }

  res.writeHead(404).end("Not found");
}).listen(PORT, () => console.log("Server running on http://localhost:" + PORT));
