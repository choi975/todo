const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const root = process.cwd();
const sourceHtml = path.join(root, "deploy", "index.html");
const testHtml = path.join(root, "work", "cache-test.html");
const port = 19117;
const today = toLocalDateString(new Date());
const yesterday = addDays(today, -1);
const tomorrow = addDays(today, 1);
const cacheKey = "todo-state-cache-v1";

const html = fs.readFileSync(sourceHtml, "utf8").replace(
  'const API_BASE = location.protocol === "file:"\n      ? "https://todo.choi975.workers.dev"\n      : location.origin;',
  `const API_BASE = "http://127.0.0.1:${port}";`
);
fs.writeFileSync(testHtml, html, "utf8");

const cachedState = {
  version: 1,
  savedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  today: yesterday,
  days: 31,
  todos: [
    { id: "cached-overdue", text: "缓存中的过期任务", dueDate: yesterday, sortOrder: 0, createdAt: "2026-07-30T00:00:00Z" },
    { id: "cached-shopping", text: "缓存中的购物项", dueDate: "__shopping__", sortOrder: 1000, createdAt: "2026-07-30T00:01:00Z" },
    { id: "cached-future", text: "缓存中的明天任务", dueDate: tomorrow, sortOrder: 0, createdAt: "2026-07-30T00:02:00Z" },
    { id: "cached-daily-old", text: "（每日任务）缓存每日任务", dueDate: yesterday, sourceDailyTaskId: "daily-old", sortOrder: 1000, createdAt: "2026-07-30T00:03:00Z" },
  ],
  dailyTasks: [{ id: "daily-old", text: "（每日任务）缓存每日任务", sortOrder: 0, placement: "top", startDate: yesterday, createdAt: "2026-07-30T00:03:00Z", completedCount: 0, totalCount: 1, checkins: [] }],
  completedCount: 2,
  counterItems: [{ id: "counter-cached", name: "缓存累计项", kind: "count", unit: "次", incrementValue: 1, color: "#256d85", pinned: 1, sortOrder: 0, active: 1, todayTotal: 3 }],
};

let stateRequests = 0;
const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Todo-Session");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && new URL(request.url, `http://127.0.0.1:${port}`).pathname === "/api/state") {
    stateRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    response.end(JSON.stringify({
      today,
      days: 31,
      todos: [{ id: "server-fresh", text: "数据库中的最新任务", dueDate: today, sortOrder: 0, createdAt: "2026-07-31T00:00:00Z" }],
      dailyTasks: [],
      completedCount: 0,
      counterItems: [],
    }));
    return;
  }
  if (request.method === "GET" && new URL(request.url, `http://127.0.0.1:${port}`).pathname === "/api/completed") {
    response.end(JSON.stringify({ total: 0, todos: [] }));
    return;
  }
  response.end(JSON.stringify({ ok: true }));
});

(async () => {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const context = await browser.newContext();
  await context.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: cacheKey, value: cachedState });
  const page = await context.newPage();
  await page.goto(`file://${testHtml.replaceAll("\\", "/")}`);

  await page.waitForFunction(() => Array.from(document.querySelectorAll(".todo-text")).some((node) => node.textContent === "缓存中的过期任务"), null, { timeout: 1000 });
  const cacheSnapshot = await page.evaluate(() => ({
    bodyReadOnly: document.body.classList.contains("read-only"),
    status: document.getElementById("status").textContent,
    newDisabled: document.getElementById("openNew").disabled,
    texts: Array.from(document.querySelectorAll(".todo-text")).map((node) => node.textContent),
    checkboxDisabled: document.querySelector(".checkbox")?.disabled === true,
    cache: JSON.parse(localStorage.getItem("todo-state-cache-v1") || "null"),
  }));

  await page.waitForFunction(() => Array.from(document.querySelectorAll(".todo-text")).some((node) => node.textContent === "数据库中的最新任务"), null, { timeout: 5000 });
  const freshSnapshot = await page.evaluate(() => ({
    bodyReadOnly: document.body.classList.contains("read-only"),
    status: document.getElementById("status").textContent,
    newDisabled: document.getElementById("openNew").disabled,
    texts: Array.from(document.querySelectorAll(".todo-text")).map((node) => node.textContent),
    checkboxDisabled: document.querySelector(".checkbox")?.disabled === true,
    cache: JSON.parse(localStorage.getItem("todo-state-cache-v1") || "null"),
  }));

  const overdueMappedToToday = cacheSnapshot.texts.includes("缓存中的过期任务")
    && cacheSnapshot.texts.filter((text) => text === "（每日任务）缓存每日任务").length === 1;
  const cacheModeWorks = cacheSnapshot.bodyReadOnly && cacheSnapshot.newDisabled && cacheSnapshot.checkboxDisabled && cacheSnapshot.status.includes("只读");
  const freshModeWorks = !freshSnapshot.bodyReadOnly && !freshSnapshot.newDisabled && !freshSnapshot.checkboxDisabled && freshSnapshot.texts.includes("数据库中的最新任务");
  const cacheUpdated = freshSnapshot.cache?.todos?.some((todo) => todo.text === "数据库中的最新任务") === true;

  console.log(JSON.stringify({ stateRequests, overdueMappedToToday, cacheModeWorks, freshModeWorks, cacheUpdated, cacheSnapshot, freshSnapshot }, null, 2));
  if (!overdueMappedToToday || !cacheModeWorks || !freshModeWorks || !cacheUpdated || stateRequests !== 1) process.exitCode = 1;
  await browser.close();
  server.close();
  fs.rmSync(testHtml, { force: true });
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
  server.close();
  fs.rmSync(testHtml, { force: true });
});

function toLocalDateString(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value, amount) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toLocalDateString(date);
}
