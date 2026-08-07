const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const root = process.cwd();
const sourceHtml = path.join(root, "deploy", "todo.html");
const testHtml = path.join(root, "work", "counter-selection-test.html");
const port = 19123;
const today = toLocalDateString(new Date());

const html = fs.readFileSync(sourceHtml, "utf8").replace(
  'const API_BASE = location.protocol === "file:" || location.hostname.endsWith(".github.io")\n      ? "https://todo.choi975.workers.dev"\n      : location.origin;',
  `const API_BASE = "http://127.0.0.1:${port}";`
);
fs.writeFileSync(testHtml, html, "utf8");

let extraItem = false;
const counterItems = () => {
  const items = [
    { id: "counter-a", name: "游泳", kind: "count", unit: "次", incrementValue: 1, color: "#256d85", pinned: 1, sortOrder: 0, active: 1, createdAt: "2026-06-30T00:00:00Z", todayTotal: 1 },
    { id: "counter-b", name: "俯卧撑", kind: "count", unit: "次", incrementValue: 1, color: "#7562a8", pinned: 1, sortOrder: 1000, active: 1, createdAt: "2026-06-30T00:01:00Z", todayTotal: 0 },
  ];
  if (extraItem) {
    items.push({ id: "counter-c", name: "羽毛球", kind: "count", unit: "次", incrementValue: 1, color: "#b5672e", pinned: 0, sortOrder: 2000, active: 1, createdAt: "2026-08-07T00:00:00Z", todayTotal: 0 });
  }
  return items;
};

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Todo-Session");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/api/state") {
    response.end(JSON.stringify({
      today,
      days: 31,
      todos: [],
      dailyTasks: [],
      completedCount: 0,
      counterItems: counterItems(),
    }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/counters") {
    response.end(JSON.stringify({
      from: url.searchParams.get("from") || today,
      to: url.searchParams.get("to") || today,
      items: counterItems(),
      records: [],
    }));
    return;
  }
  response.end(JSON.stringify({ ok: true }));
});

async function openCounter(page) {
  await page.locator("[data-counter-manage]").click();
  await page.waitForSelector("#counterBackdrop.open", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#counterFilters .counter-filter-row").length >= 2, null, { timeout: 5000 });
}

async function selectionSnapshot(page) {
  return page.evaluate(() => ({
    countText: document.querySelector("#counterFilters .counter-filter-actions span")?.textContent || "",
    checked: Array.from(document.querySelectorAll("#counterFilters .counter-filter-row")).map((row) => ({
      id: row.querySelector("[data-counter-toggle]")?.dataset.counterToggle,
      checked: Boolean(row.querySelector(".counter-check.checked")),
    })),
    storage: JSON.parse(localStorage.getItem("todo-counter-selection-v1") || "null"),
  }));
}

(async () => {
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true, executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem("todo-session-token", "test-session"));

  await page.goto(`file://${testHtml.replaceAll("\\", "/")}`);
  await page.waitForSelector("[data-counter-manage]", { timeout: 5000 });

  await openCounter(page);
  const firstOpen = await selectionSnapshot(page);
  const defaultAll = firstOpen.countText.includes("已选择 2 / 2") && firstOpen.checked.every((entry) => entry.checked);

  await page.locator('[data-counter-toggle="counter-a"]').click();
  const afterUncheck = await selectionSnapshot(page);
  const uncheckWorks = afterUncheck.countText.includes("已选择 1 / 2")
    && afterUncheck.checked.find((entry) => entry.id === "counter-a")?.checked === false
    && afterUncheck.checked.find((entry) => entry.id === "counter-b")?.checked === true
    && afterUncheck.storage?.["counter-a"] === false
    && afterUncheck.storage?.["counter-b"] === undefined;

  await page.reload();
  await page.waitForSelector("[data-counter-manage]", { timeout: 5000 });
  await openCounter(page);
  const afterReload = await selectionSnapshot(page);
  const persistsReload = afterReload.countText.includes("已选择 1 / 2")
    && afterReload.checked.find((entry) => entry.id === "counter-a")?.checked === false
    && afterReload.checked.find((entry) => entry.id === "counter-b")?.checked === true;

  extraItem = true;
  await page.reload();
  await page.waitForSelector("[data-counter-manage]", { timeout: 5000 });
  await openCounter(page);
  await page.waitForFunction(() => document.querySelectorAll("#counterFilters .counter-filter-row").length === 3, null, { timeout: 5000 });
  const afterNewItem = await selectionSnapshot(page);
  const newItemDefaultsChecked = afterNewItem.countText.includes("已选择 2 / 3")
    && afterNewItem.checked.find((entry) => entry.id === "counter-a")?.checked === false
    && afterNewItem.checked.find((entry) => entry.id === "counter-b")?.checked === true
    && afterNewItem.checked.find((entry) => entry.id === "counter-c")?.checked === true;

  await page.locator("[data-counter-select-all]").click();
  const afterSelectAll = await selectionSnapshot(page);
  const selectAllWorks = afterSelectAll.countText.includes("已选择 3 / 3") && afterSelectAll.checked.every((entry) => entry.checked);

  await page.locator("[data-counter-select-all]").click();
  const afterClearAll = await selectionSnapshot(page);
  const clearAllWorks = afterClearAll.countText.includes("已选择 0 / 3")
    && afterClearAll.checked.every((entry) => !entry.checked)
    && Object.values(afterClearAll.storage || {}).every((value) => value === false);

  await page.reload();
  await page.waitForSelector("[data-counter-manage]", { timeout: 5000 });
  await openCounter(page);
  const afterClearReload = await selectionSnapshot(page);
  const clearPersists = afterClearReload.countText.includes("已选择 0 / 3") && afterClearReload.checked.every((entry) => !entry.checked);

  await page.locator("[data-counter-select-all]").click();
  const afterSelectAllAgain = await selectionSnapshot(page);
  const selectAllPersistsCheck = afterSelectAllAgain.countText.includes("已选择 3 / 3") && afterSelectAllAgain.checked.every((entry) => entry.checked);

  const result = {
    defaultAll,
    uncheckWorks,
    persistsReload,
    newItemDefaultsChecked,
    clearAllWorks,
    clearPersists,
    selectAllWorks,
    selectAllPersistsCheck,
    noConsoleErrors: errors.length === 0,
    errors,
    firstOpen,
    afterUncheck,
    afterReload,
    afterNewItem,
    afterClearAll,
    afterClearReload,
    afterSelectAll,
    afterSelectAllAgain,
  };
  console.log(JSON.stringify(result, null, 2));
  const passed = defaultAll && uncheckWorks && persistsReload && newItemDefaultsChecked && clearAllWorks && clearPersists && selectAllWorks && selectAllPersistsCheck && result.noConsoleErrors;
  if (!passed) process.exitCode = 1;

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
