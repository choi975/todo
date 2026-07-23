const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(process.cwd(), "outputs");
const host = "127.0.0.1";
const port = 19088;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${host}:${port}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/todo.html" : url.pathname);
  const safeRelativePath = requestedPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, safeRelativePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not_found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`static-server:${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
