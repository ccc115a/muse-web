// 開發用靜態伺服器（只 serving 前端；API 仍由 Rust 後端提供）
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const port = process.env.PORT || 3000;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

http
  .createServer(async (req, res) => {
    const file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    try {
      const body = await readFile(path.join("public", file));
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  })
  .listen(port, () => console.log(`frontend preview: http://localhost:${port}`));
