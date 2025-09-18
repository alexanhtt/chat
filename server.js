const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234567890"; // đổi nếu muốn

let users = {};
let adminClients = [];
let userClients = {};
let messages = {}; // userId -> array

// Serve static files
function serveStatic(res, filePath, contentType="text/html"){
  fs.readFile(filePath, (err, data)=>{
    if(err){
      res.writeHead(404); res.end("Not found");
    } else {
      res.writeHead(200, {"Content-Type": contentType});
      res.end(data);
    }
  });
}

const server = http.createServer((req,res)=>{
  if(req.url === "/" || req.url.startsWith("/index.html")){
    return serveStatic(res, path.join(__dirname, "index.html"));
  }
  if(req.url.startsWith("/style.css")){
    return serveStatic(res, path.join(__dirname, "style.css"), "text/css");
  }
  if(req.url.startsWith("/client.js")){
    return serveStatic(res, path.join(__dirname, "client.js"), "application/javascript");
  }

  // SSE events
  if(req.url.startsWith("/events")){
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const role = urlObj.searchParams.get("role");
    res.writeHead(200, {
      "Content-Type":"text/event-stream",
      "Cache-Control":"no-cache",
      "Connection":"keep-alive"
    });

    if(role === "user"){
      const clientId = urlObj.searchParams.get("client_id");
      if(!userClients[clientId]) userClients[clientId] = [];
      userClients[clientId].push(res);
      req.on("close", ()=> {
        userClients[clientId] = userClients[clientId].filter(c => c!==res);
      });
    } else if(role === "admin"){
      const token = urlObj.searchParams.get("token");
      // simple check
      if(token) {
        adminClients.push(res);
        req.on("close", ()=> {
          adminClients = adminClients.filter(c=>c!==res);
        });
      }
    }
    return;
  }

  // APIs
  if(req.url.startsWith("/message") && req.method==="POST"){
    let body="";
    req.on("data", chunk=>body+=chunk);
    req.on("end", ()=>{
      const data = JSON.parse(body||"{}");
      const ts = new Date().toLocaleTimeString();

      if (data.role === "user") {
        if (!messages[data.client_id]) messages[data.client_id] = [];
        messages[data.client_id].push({ sender: "user", ts, message: data.message });

        // gửi cho chính user
        (userClients[data.client_id] || []).forEach(c =>
          c.write(`event: message\ndata: ${JSON.stringify({sender:"user", ts, message:data.message})}\n\n`)
        );

        // gửi cho tất cả admin
        (adminClients || []).forEach(c =>
          c.write(`event: message\ndata: ${JSON.stringify({sender:"user", ts, message:data.message, user_id:data.client_id})}\n\n`)
        );

      } else if (data.role === "admin") {
        if (!messages[data.user_id]) messages[data.user_id] = [];
        messages[data.user_id].push({ sender: "admin", ts, message: data.message });

        // gửi cho chính admin (nếu cần nhiều admin cũng nhận)
        (adminClients || []).forEach(c =>
          c.write(`event: message\ndata: ${JSON.stringify({sender:"admin", ts, message:data.message, user_id:data.user_id})}\n\n`)
        );

        // gửi cho user tương ứng
        (userClients[data.user_id] || []).forEach(c =>
          c.write(`event: message\ndata: ${JSON.stringify({sender:"admin", ts, message:data.message})}\n\n`)
        );
      }

      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({ok:true}));
    });
    return;
  }

  if(req.url.startsWith("/user/history")){
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const id = urlObj.searchParams.get("client_id");
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ok:true, history: messages[id]||[]}));
    return;
  }

  if(req.url.startsWith("/admin-login") && req.method==="POST"){
    let body=""; req.on("data", chunk=>body+=chunk);
    req.on("end", ()=>{
      const {password} = JSON.parse(body||"{}");
      if(password===ADMIN_PASSWORD){
        const token = crypto.randomUUID();
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:true, token}));
      } else {
        res.writeHead(200, {"Content-Type":"application/json"});
        res.end(JSON.stringify({ok:false}));
      }
    });
    return;
  }

  if(req.url.startsWith("/admin/users")){
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ok:true, users:Object.keys(messages)}));
    return;
  }

  if(req.url.startsWith("/admin/history")){
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const id = urlObj.searchParams.get("user_id");
    res.writeHead(200, {"Content-Type":"application/json"});
    res.end(JSON.stringify({ok:true, history:messages[id]||[]}));
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, ()=>console.log("Server running on http://localhost:"+PORT));
