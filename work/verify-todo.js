const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const root = process.cwd();
const sourceHtml = path.join(root, "deploy", "todo.html");
const testHtml = path.join(root, "work", "todo-test.html");
const screenshotPath = path.join(root, "outputs", "todo-preview.png");
const counterScreenshotPath = path.join(root, "outputs", "counter-preview.png");
const counterStatsScreenshotPath = path.join(root, "outputs", "counter-stats-preview.png");
const counterItemScreenshotPath = path.join(root, "outputs", "counter-item-preview.png");
const counterCalendarScreenshotPath = path.join(root, "outputs", "counter-calendar-preview.png");
const counterMobileScreenshotPath = path.join(root, "outputs", "counter-mobile-preview.png");
const counterStatsMobileScreenshotPath = path.join(root, "outputs", "counter-stats-mobile-preview.png");
const dailyScreenshotPath = path.join(root, "outputs", "daily-preview.png");
const dailyMobileScreenshotPath = path.join(root, "outputs", "daily-mobile-preview.png");
const workbenchMobileScreenshotPath = path.join(root, "outputs", "todo-mobile-preview.png");
const logPath = path.join(root, "work", "verify-todo.log");
fs.writeFileSync(logPath, "", "utf8");
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
console.log = (...args) => {
  fs.appendFileSync(logPath, args.map(String).join(" ") + "\n", "utf8");
  originalLog(...args);
};
console.error = (...args) => {
  fs.appendFileSync(logPath, args.map((arg) => arg && arg.stack ? arg.stack : String(arg)).join(" ") + "\n", "utf8");
  originalError(...args);
};
const TODAY = toLocalDateString(new Date());
const TOMORROW = addDays(TODAY, 1);
const DAY_AFTER = addDays(TODAY, 2);
const THIRD_DAY = addDays(TODAY, 3);
const SHOPPING_GROUP = "__shopping__";
const DAILY_TASK_PREFIX = "（每日任务）";

const html = fs.readFileSync(sourceHtml, "utf8").replace(
  'const API_BASE = location.protocol === "file:" || location.hostname.endsWith(".github.io")\n      ? "https://todo.choi975.workers.dev"\n      : location.origin;',
  'const API_BASE = "http://127.0.0.1:19087";'
);
fs.writeFileSync(testHtml, html, "utf8");

let todoCounter = 100;
let dailyTaskCounter = 10;

let todos = [
  { id: "d1-today", text: "淘宝薅羊毛", dueDate: TODAY, instanceDate: TODAY, sortOrder: 0, createdAt: "2026-06-30T00:00:00Z", sourceDailyTaskId: "d1", manualSort: 0 },
  { id: "d2-today", text: "吃饭", dueDate: TODAY, instanceDate: TODAY, sortOrder: 1000, createdAt: "2026-06-30T00:01:00Z", sourceDailyTaskId: "d2", manualSort: 0 },
  { id: "p1", text: "电池：修复OTABUG", dueDate: TODAY, sortOrder: 2000, createdAt: "2026-06-30T00:02:00Z", manualSort: 0 },
  { id: "p2", text: "电池：修复温度BUG", dueDate: TODAY, sortOrder: 3000, createdAt: "2026-06-30T00:03:00Z", manualSort: 0 },
  { id: "p3", text: "todo：增加打卡功能", dueDate: TODAY, sortOrder: 4000, createdAt: "2026-06-30T00:04:00Z", manualSort: 0 },
  { id: "r1", text: "下班跑步", dueDate: TODAY, sortOrder: 5000, createdAt: "2026-06-30T00:05:00Z", manualSort: 0 },
  { id: "d3-today", text: "喝水", dueDate: TODAY, instanceDate: TODAY, sortOrder: 6000, createdAt: "2026-06-30T00:06:00Z", sourceDailyTaskId: "d3", manualSort: 0 },
  { id: "d4-today", text: "健身", dueDate: TODAY, instanceDate: TODAY, sortOrder: 7000, createdAt: "2026-06-30T00:07:00Z", sourceDailyTaskId: "d4", manualSort: 0 },
  { id: "d1-tomorrow", text: "淘宝薅羊毛", dueDate: TOMORROW, instanceDate: TOMORROW, sortOrder: 0, createdAt: "2026-06-30T00:08:00Z", sourceDailyTaskId: "d1", manualSort: 0 },
  { id: "d3-tomorrow", text: "喝水", dueDate: TOMORROW, instanceDate: TOMORROW, sortOrder: 1000, createdAt: "2026-06-30T00:09:00Z", sourceDailyTaskId: "d3", manualSort: 0 },
  { id: "t7", text: "周五检查项目进度", dueDate: THIRD_DAY, sortOrder: 1000, createdAt: "2026-06-30T00:10:00Z", manualSort: 0 },
];

let dailyTasks = [
  { id: "d1", text: "淘宝薅羊毛", sortOrder: 0, placement: "top", startDate: TODAY, createdAt: "2026-06-30T00:00:00Z" },
  { id: "d2", text: "吃饭", sortOrder: 1000, placement: "top", startDate: TODAY, createdAt: "2026-06-30T00:01:00Z" },
  { id: "d3", text: "喝水", sortOrder: 2000, placement: "bottom", startDate: TODAY, createdAt: "2026-06-30T00:02:00Z" },
  { id: "d4", text: "健身", sortOrder: 3000, placement: "bottom", startDate: TODAY, createdAt: "2026-06-30T00:03:00Z" },
];
const dailyCheckins = { d1: new Set(), d2: new Set(), d3: new Set(), d4: new Set() };
const completedDailyTodos = new Map();
let completedTodos = [];
let counterItems = [
  { id: "counter-swim", name: "游泳", kind: "duration", unit: "小时", incrementValue: 1, color: "#256d85", pinned: 1, sortOrder: 0, active: 1, createdAt: "2026-06-30T00:00:00Z" },
  { id: "counter-pushup", name: "俯卧撑", kind: "count", unit: "次", incrementValue: 10, color: "#7562a8", pinned: 1, sortOrder: 1000, active: 1, createdAt: "2026-06-30T00:01:00Z" },
];
let counterRecords = [
  { id: "counter-record-1", itemId: "counter-swim", amount: 3, recordedDate: TODAY, recordedAt: "2026-07-16T10:00:00.000Z", createdAt: "2026-07-16T10:00:00.000Z" },
];

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Todo-Session");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, "http://127.0.0.1:19087");
  if (req.method === "GET" && url.pathname === "/api/state") {
    normalizeState();
    normalizeCounterData();
    res.end(JSON.stringify({ today: TODAY, days: 31, todos, dailyTasks: dailyTasksWithStats(), completedCount: completedTodos.length, counterItems: counterItems.map((item) => ({ ...item, todayTotal: counterRecords.filter((record) => record.itemId === item.id && record.recordedDate === TODAY).reduce((sum, record) => sum + record.amount, 0) })) }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/completed") {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 100)));
    const rows = [...completedTodos]
      .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)))
      .slice(0, limit);
    res.end(JSON.stringify({ today: TODAY, total: completedTodos.length, limit, todos: rows }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/counters") {
    normalizeCounterData();
    const from = url.searchParams.get("from") || TODAY;
    const to = url.searchParams.get("to") || TODAY;
    res.end(JSON.stringify({ from, to, items: counterItems.filter((item) => item.active), records: counterRecords.filter((record) => record.recordedDate >= from && record.recordedDate <= to) }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const json = body ? JSON.parse(body) : {};

    if (req.method === "POST" && url.pathname === "/api/todos") {
      const id = nextTodoId();
      const text = normalizeText(json.text);
      const dueDate = normalizeDueDate(json.dueDate, text);
      todos.push({
        id,
        text,
        dueDate,
        sortOrder: 9999,
        createdAt: new Date().toISOString(),
        manualSort: 0,
      });
      placeTodoByDefault(dueDate, id);
      res.end(JSON.stringify({ id }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-tasks") {
      const id = nextDailyTaskId();
      const text = normalizeDailyText(json.text);
      dailyTasks.push({
        id,
        text,
        sortOrder: nextDailySortOrder(),
        placement: "top",
        startDate: json.today || TODAY,
        createdAt: new Date().toISOString(),
      });
      dailyCheckins[id] = new Set();
      for (const dueDate of [TODAY, TOMORROW, DAY_AFTER, THIRD_DAY]) {
        const todoId = nextTodoId();
        const effectiveDueDate = normalizeDueDate(dueDate, text);
        todos.push({
          id: todoId,
          text,
          dueDate: effectiveDueDate,
          instanceDate: dueDate,
          sortOrder: 9999,
          createdAt: new Date().toISOString(),
          sourceDailyTaskId: id,
          manualSort: 0,
        });
        placeTodoByDefault(effectiveDueDate, todoId);
      }
      res.end(JSON.stringify({ id }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-tasks/update") {
      const task = dailyTasks.find((entry) => entry.id === json.id);
      if (!task) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const text = normalizeDailyText(json.text);
      task.text = text;
      for (const todo of todos) {
        if (todo.sourceDailyTaskId === json.id) todo.text = text;
      }
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/counter-items") {
      const id = `counter-${Date.now()}`;
      const item = { id, name: normalizeText(json.name), kind: "count", unit: "次", incrementValue: 1, color: json.color || "#256d85", pinned: json.pinned ? 1 : 0, sortOrder: counterItems.length * 1000, active: 1, createdAt: new Date().toISOString() };
      counterItems.push(item);
      res.end(JSON.stringify(item));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/counter-items/update") {
      const item = counterItems.find((entry) => entry.id === json.id);
      if (!item) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      Object.assign(item, { name: normalizeText(json.name), kind: "count", unit: "次", incrementValue: 1, color: json.color || item.color, pinned: json.pinned ? 1 : 0 });
      res.end(JSON.stringify(item));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/counter-items/archive") {
      const item = counterItems.find((entry) => entry.id === json.id);
      if (item) Object.assign(item, { active: 0, pinned: 0 });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/counter-records") {
      const record = { id: `counter-record-${Date.now()}`, itemId: json.itemId, amount: 1, recordedDate: json.recordedDate || TODAY, recordedAt: json.recordedAt || new Date().toISOString(), createdAt: new Date().toISOString() };
      counterRecords.push(record);
      res.end(JSON.stringify(record));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/counter-records/delete") {
      counterRecords = counterRecords.filter((record) => record.id !== json.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-tasks/delete") {
      dailyTasks = dailyTasks.filter((task) => task.id !== json.id);
      delete dailyCheckins[json.id];
      todos = todos.filter((todo) => todo.sourceDailyTaskId !== json.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-tasks/placement") {
      updateDailyTaskPlacement(json.id, json.placement === "bottom" ? "bottom" : "top");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/complete") {
      const todo = todos.find((item) => item.id === json.id);
      if (todo?.sourceDailyTaskId) {
        if (!dailyCheckins[todo.sourceDailyTaskId]) dailyCheckins[todo.sourceDailyTaskId] = new Set();
        dailyCheckins[todo.sourceDailyTaskId].add(todo.instanceDate || todo.dueDate);
        completedDailyTodos.set(completedTodoKey(todo.sourceDailyTaskId, todo.instanceDate || todo.dueDate), todo);
      } else if (todo) {
        completedTodos.push({
          ...todo,
          completedAt: new Date().toISOString(),
        });
      }
      todos = todos.filter((item) => item.id !== json.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/restore") {
      const todo = completedTodos.find((item) => item.id === json.id);
      if (!todo) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      completedTodos = completedTodos.filter((item) => item.id !== json.id);
      delete todo.completedAt;
      todo.dueDate = isShoppingText(todo.text) ? SHOPPING_GROUP : TODAY;
      todo.sortOrder = 9999;
      todo.manualSort = 0;
      todos.push(todo);
      placeTodoByDefault(todo.dueDate, todo.id);
      res.end(JSON.stringify({ ok: true, id: todo.id, dueDate: todo.dueDate }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/daily-tasks/checkin") {
      if (!dailyCheckins[json.id]) dailyCheckins[json.id] = new Set();
      if (json.checked) {
        dailyCheckins[json.id].add(json.date);
      } else {
        dailyCheckins[json.id].delete(json.date);
      }
      if (json.date === TODAY) syncTodayTodoFromCheckin(json.id, Boolean(json.checked));
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/update") {
      const todo = todos.find((item) => item.id === json.id);
      if (!todo) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      todo.text = todo.sourceDailyTaskId ? normalizeDailyText(json.text) : normalizeText(json.text);
      if (!todo.sourceDailyTaskId) todo.dueDate = normalizeDueDate(todo.dueDate, todo.text);
      placeTodoByDefault(todo.dueDate, todo.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/top") {
      moveTodoToTop(json.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/bottom") {
      moveTodoToBottom(json.id);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/todos/move") {
      moveTodoByStep(json.id, json.direction === "down" ? "down" : "up");
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not_found" }));
  });
});

(async () => {
  await new Promise((resolve) => server.listen(19087, "127.0.0.1", resolve));
  console.log("verify: server ready");
  const browserPath = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].find((candidate) => fs.existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("todo-session-token", "test-session"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(`file://${testHtml.replaceAll("\\", "/")}`);
  await page.waitForSelector(".todo.selected", { timeout: 5000 }).catch(async (error) => {
    console.error("page errors before load:", errors.join(" | "));
    throw error;
  });
  console.log("verify: page loaded");

  const selectedKeyboardTarget = () => page.evaluate(() => {
    const selected = document.querySelector(".todo.selected, .daily-row.selected, .counter-home-item.selected");
    if (!selected) return "";
    if (selected.matches(".todo")) return `todo:${selected.dataset.id}`;
    if (selected.matches(".daily-row")) return `daily:${selected.dataset.dailyId}`;
    return `counter:${selected.dataset.counterItemId}`;
  });
  const prefixFirstId = await page.locator("#prefixGroups .todo").first().getAttribute("data-id");
  const todayFirstId = await page.locator("#todayTodos .todo").first().getAttribute("data-id");
  const dailyFirstId = await page.locator("#workbenchDaily .daily-row").first().getAttribute("data-daily-id");
  const counterIds = await page.locator("#workbenchCounters .counter-home-item").evaluateAll((nodes) => nodes.map((node) => node.dataset.counterItemId));
  await page.locator(`#prefixGroups .todo[data-id="${prefixFirstId}"]`).click();
  await page.keyboard.press("ArrowRight");
  if (await selectedKeyboardTarget() !== `todo:${todayFirstId}`) throw new Error("ArrowRight card navigation failed");
  await page.keyboard.press("ArrowLeft");
  if (await selectedKeyboardTarget() !== `todo:${prefixFirstId}`) throw new Error("ArrowLeft card navigation failed");
  await page.keyboard.press("ArrowLeft");
  if (await selectedKeyboardTarget() !== `counter:${counterIds.at(-1)}`) throw new Error("ArrowLeft counter wrap failed");
  await page.keyboard.press("Tab");
  if (await selectedKeyboardTarget() !== `todo:${prefixFirstId}`) throw new Error("Tab counter wrap failed");
  const todayLastId = await page.locator("#todayTodos .todo").last().getAttribute("data-id");
  await page.locator(`#todayTodos .todo[data-id="${todayLastId}"]`).click();
  await page.keyboard.press("ArrowDown");
  if (await selectedKeyboardTarget() !== `daily:${dailyFirstId}`) throw new Error("ArrowDown today-to-daily navigation failed");
  await page.keyboard.press("ArrowUp");
  if (!(await selectedKeyboardTarget()).startsWith("todo:")) throw new Error("ArrowUp reverse navigation failed");
  const todayIdsBeforeAltMove = await page.locator("#todayTodos .todo").evaluateAll((nodes) => nodes.map((node) => node.dataset.id));
  if (todayIdsBeforeAltMove.length > 1) {
    const movedId = todayIdsBeforeAltMove[1];
    await page.locator(`#todayTodos .todo[data-id="${movedId}"]`).click();
    await page.keyboard.down("Alt");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.up("Alt");
    await page.waitForFunction((id) => document.querySelector("#todayTodos .todo")?.dataset.id === id, movedId);
    const firstAfterAltMove = await page.locator("#todayTodos .todo").first().getAttribute("data-id");
    if (firstAfterAltMove !== movedId) throw new Error("Alt+ArrowUp priority move failed");
    await page.keyboard.press("2");
    await page.waitForFunction((id) => document.querySelector("#todayTodos .todo:last-child")?.dataset.id === id, movedId);
  }
  console.log("verify: keyboard navigation passed");

  const initialSelected = await page.locator(".todo.selected .todo-text").innerText();
  const counterMigrationApplied = counterItems.every((item) => item.kind === "count" && item.unit === "次" && item.incrementValue === 1)
    && counterRecords.every((record) => record.amount === 1);
  if (!counterMigrationApplied) throw new Error("counter migration was not applied");

  const helpRemoved = await page.locator("#openHelp, #helpBackdrop").count() === 0;
  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector("#modalBackdrop.open", { timeout: 5000 });
  const dailyPanelRemovedFromNew = await page.locator("#modalBackdrop .daily-panel, #modalBackdrop #dailyItems").count() === 0;
  const dailyOptionExists = await page.locator('#dateSelect option[value="daily"]').count() === 1;
  const counterOptionInNewExists = await page.locator('#dateSelect option[value="counter"]').count() === 1;
  await page.keyboard.press("Escape");

  const initialDailyStats = await page.locator(".daily-count-button").first().innerText();
  await page.locator(".daily-count-button").first().click();
  await page.waitForSelector("#checkinBackdrop.open", { timeout: 5000 });
  await page.locator(`.checkin-day[data-date="${TODAY}"]`).click();
  await page.waitForFunction(() => {
    const button = document.querySelector(".daily-count-button");
    return button && (button.textContent || "").includes("1/1") && (button.textContent || "").includes("100.00%");
  });
  const afterBackfillStats = await page.locator(".daily-count-button").first().innerText();
  await page.locator(`.checkin-day[data-date="${TODAY}"]`).click();
  await page.waitForFunction(() => {
    const button = document.querySelector(".daily-count-button");
    return button && (button.textContent || "").includes("0/1") && (button.textContent || "").includes("0.00%");
  });
  const afterCancelBackfillStats = await page.locator(".daily-count-button").first().innerText();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#checkinBackdrop.open"));
  const dailyTopButtons = await page.locator('[aria-label^="每日任务置顶："]').count();
  const dailyBottomButtons = await page.locator('[aria-label^="每日任务置底："]').count();

  await page.fill("#dailyText", "阅读");
  await page.locator("#dailyForm").getByRole("button", { name: "新建" }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#workbenchDaily .daily-main strong")).some((node) => node.textContent === "阅读"));
  await page.getByRole("button", { name: "编辑每日任务：阅读" }).click();
  await page.fill("#dailyText", "晨间阅读");
  await page.locator("#dailyForm").getByRole("button", { name: "保存" }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#workbenchDaily .daily-main strong")).some((node) => node.textContent === "晨间阅读"));
  const dailyEditUpdatedTodos = todos.some((todo) => todo.sourceDailyTaskId && todo.text === "（每日任务）晨间阅读");
  await page.screenshot({ path: dailyScreenshotPath, fullPage: true });
  await page.getByRole("button", { name: "删除每日任务：晨间阅读" }).click();
  await page.waitForFunction(() => !Array.from(document.querySelectorAll("#workbenchDaily .daily-main strong")).some((node) => node.textContent === "晨间阅读"));
  console.log("verify: daily manager passed");

  const initialPrefixGroupCount = await page.locator("#prefixGroups .prefix-group").count();
  const initialPrefixTaskCount = await page.locator("#prefixGroups .todo").count();
  const initialTodayOrder = await todayWorkbenchTexts(page);
  const dailyDashboardCount = await page.locator("#workbenchDaily .daily-row").count();
  const dailyInstancesHiddenFromDates = await page.locator('#todayTodos .todo[data-id^="d"], #upcomingGroups .todo[data-id^="d"]').count() === 0;
  const upcomingRegularVisible = await page.locator('#upcomingGroups .workbench-task-label').filter({ hasText: "周五检查项目进度" }).count() === 1;
  if (initialPrefixGroupCount !== 2 || initialPrefixTaskCount !== 3 || initialTodayOrder.join("|") !== "下班跑步" || dailyDashboardCount !== 4 || !dailyInstancesHiddenFromDates || !upcomingRegularVisible) {
    throw new Error("initial workbench partition failed");
  }
  console.log("verify: initial workbench partition passed");

  await createTodayTodo(page, "todo：优化排序问题");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#prefixGroups .workbench-task-label")).some((node) => node.textContent === "优化排序问题"));
  const prefixTasksAlwaysExpanded = await page.locator("#prefixGroups .todo").count() === 4
    && await page.locator("#prefixGroups .todo-action").count() === 0;
  if (!prefixTasksAlwaysExpanded) throw new Error("prefix workbench rendering failed");

  await createTodayTodo(page, "处理发票");
  await expectTodayOrder(page, ["处理发票", "下班跑步"]);
  await page.locator("#todayTodos").getByRole("button", { name: "置底：处理发票" }).click({ force: true });
  await expectTodayOrder(page, ["下班跑步", "处理发票"]);
  await page.locator("#todayTodos").getByRole("button", { name: "置顶：处理发票" }).click({ force: true });
  await expectTodayOrder(page, ["处理发票", "下班跑步"]);
  console.log("verify: regular workbench ordering passed");

  await page.getByRole("button", { name: "完成：处理发票" }).click();
  await page.waitForFunction(() => {
    const button = document.getElementById("openCompleted");
    return button && !document.getElementById("completedBadge") && button.getAttribute("aria-label") === "打开已完成任务，共 1 项";
  });
  await page.getByRole("button", { name: /打开已完成任务/ }).click();
  await page.waitForSelector("#completedBackdrop.open", { timeout: 5000 });
  await page.waitForSelector(".completed-item", { timeout: 5000 });
  const completedSummary = await page.locator("#completedSummary").innerText();
  const completedListText = await page.locator("#completedList").innerText();
  const completedHasRegular = completedListText.includes("处理发票");
  const completedHasDaily = completedListText.includes("（每日任务）");
  await page.getByRole("button", { name: "恢复：处理发票" }).click();
  await page.waitForFunction(() => {
    const button = document.getElementById("openCompleted");
    return button && !document.getElementById("completedBadge") && button.getAttribute("aria-label") === "打开已完成任务";
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#todayTodos .workbench-task-label")).some((node) => node.textContent === "处理发票"));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#completedBackdrop.open"));
  await expectTodayOrder(page, ["处理发票", "下班跑步"]);
  console.log("verify: completed history restore passed");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector(".modal-backdrop.open");
  await page.fill("#newText", "买早餐");
  await page.locator("#dateSelect").selectOption("daily");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#workbenchDaily .daily-main strong")).some((node) => node.textContent === "买早餐"));
  console.log("verify: daily buy create passed");
  const breakfastTaskId = dailyTasks.find((task) => task.text === "（每日任务）买早餐")?.id;
  const createdDailyDates = todos.filter((todo) => todo.sourceDailyTaskId === breakfastTaskId).map((todo) => todo.instanceDate || todo.dueDate);
  const dailyBreakfastHiddenFromDatePanels = await page.locator('#todayTodos .workbench-task-label, #upcomingGroups .workbench-task-label').allTextContents().then((values) => values.every((value) => !value.includes("买早餐")));
  if (!dailyBreakfastHiddenFromDatePanels) throw new Error("daily task duplicated in date panels");

  await page.getByRole("button", { name: "删除每日任务：喝水" }).click();
  await page.waitForFunction(() => {
    return !Array.from(document.querySelectorAll("#dailyItems .daily-main strong")).some((node) => (node.textContent || "") === "喝水");
  });
  console.log("verify: daily delete passed");

  const initialCounterShortcutCount = await page.locator(".counter-shortcut").count();
  const counterRecordsBeforeQuick = counterRecords.length;
  await page.locator('#workbenchCounters [data-counter-id="counter-swim"]').click();
  await page.waitForSelector("#counterToast.open", { timeout: 5000 });
  const counterToastText = await page.locator("#counterToastMessage").innerText();
  await page.getByRole("button", { name: "撤销" }).click();
  await page.waitForFunction(() => !document.querySelector("#counterToast.open"));
  const counterUndoRestoredCount = counterRecords.length === counterRecordsBeforeQuick;

  await page.getByRole("button", { name: "打开累计统计" }).click();
  await page.waitForSelector("#counterBackdrop.open", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll("#counterFilters .counter-filter-row").length >= 2);
  const counterSummaryText = await page.locator("#counterSummary").innerText();
  const counterRecordsBeforeSidebarQuick = counterRecords.length;
  await page.locator('[data-counter-add="counter-swim"]').click();
  await page.waitForSelector("#counterToast.open", { timeout: 5000 });
  const counterSidebarQuickAdded = counterRecords.length === counterRecordsBeforeSidebarQuick + 1;
  await page.getByRole("button", { name: "撤销" }).click();
  await page.waitForFunction(() => !document.querySelector("#counterToast.open"));
  if (!counterSidebarQuickAdded || counterRecords.length !== counterRecordsBeforeSidebarQuick) throw new Error("counter sidebar quick add failed");

  await page.getByRole("button", { name: /新建记录项/ }).click();
  await page.waitForSelector("#counterItemBackdrop.open", { timeout: 5000 });
  await page.screenshot({ path: counterItemScreenshotPath, fullPage: true });
  await page.fill("#counterItemName", "羽毛球");
  await page.getByRole("button", { name: "保存" }).click();
  await page.waitForFunction(() => !document.querySelector("#counterItemBackdrop.open"));
  await page.waitForFunction(() => (document.querySelector("#counterFilters")?.textContent || "").includes("羽毛球"));

  await page.getByRole("button", { name: "补记" }).click();
  await page.waitForSelector("#counterRecordBackdrop.open", { timeout: 5000 });
  await page.locator('[data-counter-record-item]').filter({ hasText: "羽毛球" }).click();
  await page.waitForSelector(`[data-counter-calendar-date="${TODAY}"]:not([disabled])`, { timeout: 5000 });
  await page.locator(`[data-counter-calendar-date="${TODAY}"]`).click();
  await page.waitForFunction((today) => (document.querySelector(`[data-counter-calendar-date="${today}"]`)?.textContent || "").includes("1次"), TODAY);
  await page.locator(`[data-counter-calendar-date="${TODAY}"]`).click();
  await page.waitForFunction((today) => (document.querySelector(`[data-counter-calendar-date="${today}"]`)?.textContent || "").includes("2次"), TODAY);
  await page.screenshot({ path: counterCalendarScreenshotPath, fullPage: true });
  await page.locator("#cancelCounterRecord").click();
  await page.waitForFunction(() => !document.querySelector("#counterRecordBackdrop.open"));
  await page.waitForFunction(() => (document.querySelector("#counterRecords")?.textContent || "").includes("羽毛球"));
  await page.waitForSelector('#counterCharts [data-counter-stats-chart]');
  const counterModeControlsRemoved = await page.locator("#counterChartModes").count() === 0
    && await page.locator("[data-chart-mode]").count() === 0;
  const counterStatsChartWorks = await page.locator('#counterCharts [data-counter-stats-chart] .counter-panel-head h3').innerText() === "统计"
    && await page.locator('#counterCharts [data-counter-pie]').count() === 1
    && await page.locator('#counterCharts .counter-pie-total strong').innerText().then((text) => /^\d+(?:\.\d+)?次$/.test(text))
    && await page.locator('#counterCharts .counter-pie-legend-row').count() === 3
    && await page.locator('#counterCharts .counter-pie-legend-percent').allTextContents().then((values) => values.every((value) => /^\d+(?:\.\d+)?%$/.test(value)))
    && await page.locator('#counterCharts .counter-pie-segment').count() === 2
    && await page.locator('#counterCharts .counter-pie-legend-row.is-zero').count() === 1;
  await page.locator('#counterCharts [data-counter-pie-index="0"]').hover();
  const counterLegendHighlightWorks = await page.locator('#counterCharts .counter-pie-segment.is-active').count() === 1
    && await page.locator('#counterCharts .counter-pie-segment:not(.is-active)').count() === 1
    && await page.locator('#counterCharts [data-counter-pie-index="0"].is-active').count() === 1;
  await page.mouse.move(0, 0);
  if (!counterModeControlsRemoved || !counterStatsChartWorks || !counterLegendHighlightWorks) throw new Error("counter statistics chart failed");
  await page.screenshot({ path: counterStatsScreenshotPath, fullPage: true });
  const counterCreatedAndRecorded = counterItems.some((item) => item.name === "羽毛球") && counterRecords.some((record) => record.itemId === counterItems.find((item) => item.name === "羽毛球")?.id);
  const counterCalendarRepeated = counterRecords.filter((record) => record.itemId === counterItems.find((item) => item.name === "羽毛球")?.id && record.recordedDate === TODAY).length === 2;
  await page.screenshot({ path: counterScreenshotPath, fullPage: true });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("#counterBackdrop.open"));
  console.log("verify: counter feature passed");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector("#modalBackdrop.open", { timeout: 5000 });
  const counterOptionExists = await page.locator('#dateSelect option[value="counter"]').count() === 1;
  await page.locator("#dateSelect").selectOption("counter");
  await page.fill("#newText", "每天：晨跑");
  await page.locator("#newForm button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#modalBackdrop.open"));
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#workbenchDaily .daily-main strong")).some((node) => node.textContent === "晨跑"));
  const autoDailyCreated = dailyTasks.some((task) => task.text === "（每日任务）晨跑");

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector("#modalBackdrop.open", { timeout: 5000 });
  await page.locator("#dateSelect").selectOption("daily");
  await page.fill("#newText", "累计：散步");
  await page.locator("#newForm button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#modalBackdrop.open"));
  await page.waitForTimeout(150);
  const autoCounterCreated = counterItems.some((item) => item.name === "散步" && item.unit === "次" && item.incrementValue === 1);

  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector("#modalBackdrop.open", { timeout: 5000 });
  await page.locator("#dateSelect").selectOption("counter");
  await page.fill("#newText", "阅读");
  await page.locator("#newForm button[type=submit]").click();
  await page.waitForFunction(() => !document.querySelector("#modalBackdrop.open"));
  await page.waitForTimeout(150);
  const counterDropdownCreated = counterItems.some((item) => item.name === "阅读" && item.unit === "次" && item.incrementValue === 1);
  console.log("verify: automatic new-item routing passed");

  const upcomingDate = addDays(TODAY, 2);
  const upcomingWeekday = "日一二三四五六"[new Date(`${upcomingDate}T00:00:00`).getDay()];
  await createAutomaticTodo(page, `周${upcomingWeekday}跑步`);
  const nextWeekSunday = getNextWeekdayDate(TODAY, 0);
  await createAutomaticTodo(page, "下周日游泳");
  const monthDayDate = addDays(TODAY, 5);
  const monthDay = new Date(`${monthDayDate}T00:00:00`);
  const monthDayText = `${monthDay.getMonth() + 1}月${monthDay.getDate()}日骑车`;
  await createAutomaticTodo(page, monthDayText);
  const monthDayNumberDate = addDays(TODAY, 6);
  const monthDayNumber = new Date(`${monthDayNumberDate}T00:00:00`);
  const monthDayNumberText = `${monthDayNumber.getMonth() + 1}月${monthDayNumber.getDate()}号打羽毛球`;
  await createAutomaticTodo(page, monthDayNumberText);
  const automaticDateRoutingPassed = todos.some((todo) => todo.text === "跑步" && todo.dueDate === upcomingDate)
    && todos.some((todo) => todo.text === "游泳" && todo.dueDate === nextWeekSunday)
    && todos.some((todo) => todo.text === monthDayText && todo.dueDate === monthDayDate)
    && todos.some((todo) => todo.text === monthDayNumberText && todo.dueDate === monthDayNumberDate);
  if (!automaticDateRoutingPassed) throw new Error("automatic date routing failed");
  console.log("verify: automatic date recognition passed");

  await createAutomaticTodo(page, "明天跑步");
  await createAutomaticTodo(page, "后天游泳");
  await createAutomaticTodo(page, "三天后骑车");
  await createAutomaticTodo(page, "4天后打羽毛球");
  const relativeDateRoutingPassed = todos.some((todo) => todo.text === "跑步" && todo.dueDate === addDays(TODAY, 1))
    && todos.some((todo) => todo.text === "游泳" && todo.dueDate === addDays(TODAY, 2))
    && todos.some((todo) => todo.text === "骑车" && todo.dueDate === addDays(TODAY, 3))
    && todos.some((todo) => todo.text === "打羽毛球" && todo.dueDate === addDays(TODAY, 4));
  if (!relativeDateRoutingPassed) throw new Error("relative date routing failed");
  console.log("verify: relative date recognition passed");

  await page.waitForFunction(() => (document.querySelector("#upcomingGroups")?.textContent || "").includes("周五检查项目进度"));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobilePage.addInitScript(() => localStorage.setItem("todo-session-token", "test-session"));
  await mobilePage.goto(`file://${testHtml.replaceAll("\\", "/")}`);
  await mobilePage.waitForSelector(".todo.selected", { timeout: 5000 });
  await mobilePage.screenshot({ path: workbenchMobileScreenshotPath, fullPage: true });
  await mobilePage.getByRole("button", { name: "打开累计统计" }).click();
  await mobilePage.waitForSelector("#counterBackdrop.open", { timeout: 5000 });
  await mobilePage.waitForFunction(() => document.querySelectorAll("#counterFilters .counter-filter-row").length >= 2, null, { timeout: 5000 });
  const mobileCounterControlsVisible = await mobilePage.locator("#counterFilters [data-counter-add]").count() >= 2
    && await mobilePage.locator("#counterPeriods [data-period]").count() === 4
    && await mobilePage.locator("#counterChartModes").count() === 0;
  if (!mobileCounterControlsVisible) throw new Error("counter controls hidden on mobile");
  await mobilePage.waitForSelector('#counterCharts [data-counter-stats-chart] [data-counter-pie]');
  await mobilePage.locator('#counterCharts [data-counter-stats-chart]').screenshot({ path: counterStatsMobileScreenshotPath });
  await mobilePage.screenshot({ path: counterMobileScreenshotPath, fullPage: true });
  await mobilePage.keyboard.press("Escape");
  await mobilePage.waitForFunction(() => !document.querySelector("#counterBackdrop.open"));
  const mobileDailyControlsVisible = await mobilePage.locator("#dailyForm #dailyText").isVisible()
    && await mobilePage.locator("#dailyItems .daily-row").count() >= 1
    && await mobilePage.locator('#dailyItems [aria-label^="编辑每日任务："]').first().isVisible();
  if (!mobileDailyControlsVisible) throw new Error("daily manager controls hidden on mobile");
  await mobilePage.screenshot({ path: dailyMobileScreenshotPath, fullPage: true });

  await browser.close();
  server.close();

  const result = {
    initialSelected,
    helpRemoved,
    dailyPanelRemovedFromNew,
    dailyOptionExists,
    counterOptionInNewExists,
    dailyEditUpdatedTodos,
    initialDailyStats,
    afterBackfillStats,
    afterCancelBackfillStats,
    dailyTopButtons,
    dailyBottomButtons,
    completedSummary,
    completedHasRegular,
    completedHasDaily,
    createdDailyDates,
    initialCounterShortcutCount,
    counterToastText,
    counterUndoRestoredCount,
    counterMigrationApplied,
    counterSummaryText,
    counterSidebarQuickAdded,
    counterModeControlsRemoved,
    counterStatsChartWorks,
    counterLegendHighlightWorks,
    mobileCounterControlsVisible,
    mobileDailyControlsVisible,
    counterCreatedAndRecorded,
    counterCalendarRepeated,
    counterOptionExists,
    autoDailyCreated,
    autoCounterCreated,
    counterDropdownCreated,
    automaticDateRoutingPassed,
    relativeDateRoutingPassed,
    finalTodayOrder: orderedTodosForDate(TODAY).map((todo) => todo.text),
    todoCount: todos.length,
    dailyCount: dailyTasks.length,
    errors,
    screenshotPath,
    counterScreenshotPath,
    counterStatsScreenshotPath,
    counterItemScreenshotPath,
    counterCalendarScreenshotPath,
    counterMobileScreenshotPath,
    counterStatsMobileScreenshotPath,
    dailyScreenshotPath,
    dailyMobileScreenshotPath,
    workbenchMobileScreenshotPath,
  };
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) process.exitCode = 1;
})().catch((error) => {
  server.close();
  console.error(error);
  process.exitCode = 1;
});

function nextTodoId() {
  todoCounter += 1;
  return `t${todoCounter}`;
}

function nextDailyTaskId() {
  dailyTaskCounter += 1;
  return `d${dailyTaskCounter}`;
}

function nextDailySortOrder() {
  const max = dailyTasks.reduce((result, task) => Math.max(result, Number(task.sortOrder) || 0), -1000);
  return max + 1000;
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizeDueDate(dueDate, text) {
  return isShoppingText(text) ? SHOPPING_GROUP : dueDate;
}

function isShoppingText(value) {
  return normalizeText(value).startsWith("买");
}

function normalizeDailyText(value) {
  const text = normalizeText(value);
  return text.startsWith(DAILY_TASK_PREFIX) ? text : DAILY_TASK_PREFIX + text;
}

function normalizeState() {
  for (const task of dailyTasks) {
    task.text = normalizeDailyText(task.text);
  }
  for (const todo of todos) {
    if (!todo.sourceDailyTaskId) continue;
    todo.text = normalizeDailyText(todo.text);
    if (todo.dueDate === SHOPPING_GROUP && todo.instanceDate) todo.dueDate = todo.instanceDate;
  }
  const dates = Array.from(new Set(todos.map((todo) => todo.dueDate)));
  for (const dueDate of dates) {
    if (dueDate === SHOPPING_GROUP) continue;
    writeDayOrder(dueDate, canonicalizeRows(orderedTodosForDate(dueDate)));
  }
}

function normalizeCounterData() {
  counterItems = counterItems.map((item) => ({ ...item, kind: "count", unit: "次", incrementValue: 1 }));
  counterRecords = counterRecords.map((record) => ({ ...record, amount: 1 }));
}

function sortTodos(a, b) {
  return a.dueDate.localeCompare(b.dueDate) || Number(a.sortOrder) - Number(b.sortOrder) || a.createdAt.localeCompare(b.createdAt);
}

function orderedTodosForDate(dueDate) {
  return todos.filter((todo) => todo.dueDate === dueDate).sort(sortTodos);
}

function writeDayOrder(dueDate, ordered) {
  ordered.forEach((todo, index) => {
    todo.dueDate = dueDate;
    todo.sortOrder = index * 1000;
  });
}

function getDailyTask(id) {
  return dailyTasks.find((task) => task.id === id) || null;
}

function getAutoPlacement(todo) {
  if (!todo || !todo.sourceDailyTaskId) return null;
  const task = getDailyTask(todo.sourceDailyTaskId);
  if (!task) return null;
  return task.placement === "bottom" ? "bottom" : "top";
}

function compareDailyTasks(leftId, rightId) {
  const left = getDailyTask(leftId);
  const right = getDailyTask(rightId);
  const leftOrder = Number(left?.sortOrder) || 0;
  const rightOrder = Number(right?.sortOrder) || 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""));
}

function extractPrefix(value) {
  const match = normalizeText(value).match(/^([^:：]{1,48})[:：]/);
  return match ? match[1].trim().toLocaleLowerCase() : "";
}

function canonicalizeRows(rows) {
  return flattenPartitions(partitionRows(rows));
}

function partitionRows(rows) {
  const topDaily = [];
  const bottomDaily = [];
  const prefixGroups = new Map();
  const prefixOrder = [];
  const regular = [];

  for (const row of rows) {
    const placement = getAutoPlacement(row);
    if (placement === "top") {
      topDaily.push(row);
      continue;
    }
    if (placement === "bottom") {
      bottomDaily.push(row);
      continue;
    }
    const prefix = extractPrefix(row.text);
    if (!prefix) {
      regular.push(row);
      continue;
    }
    if (!prefixGroups.has(prefix)) {
      prefixGroups.set(prefix, { prefix, rows: [] });
      prefixOrder.push(prefix);
    }
    prefixGroups.get(prefix).rows.push(row);
  }

  return {
    topDaily,
    prefixGroups: prefixOrder.map((prefix) => prefixGroups.get(prefix)),
    regular,
    bottomDaily,
  };
}

function flattenPartitions(parts) {
  return parts.topDaily
    .concat(...parts.prefixGroups.map((group) => group.rows))
    .concat(parts.regular, parts.bottomDaily);
}

function insertDailyRow(rows, row) {
  const insertIndex = rows.findIndex((current) => compareDailyTasks(current.sourceDailyTaskId, row.sourceDailyTaskId) > 0);
  if (insertIndex < 0) {
    rows.push(row);
  } else {
    rows.splice(insertIndex, 0, row);
  }
}

function locatePrefixRow(parts, id) {
  for (let groupIndex = 0; groupIndex < parts.prefixGroups.length; groupIndex += 1) {
    const rowIndex = parts.prefixGroups[groupIndex].rows.findIndex((row) => row.id === id);
    if (rowIndex >= 0) return { groupIndex, rowIndex };
  }
  return null;
}

function placeTodoByDefault(dueDate, todoId) {
  const target = todos.find((todo) => todo.id === todoId);
  if (!target) return;
  if (target.sourceDailyTaskId) target.text = normalizeDailyText(target.text);
  const rows = orderedTodosForDate(dueDate).filter((todo) => todo.id !== todoId);
  if (dueDate === SHOPPING_GROUP) {
    rows.unshift(target);
    writeDayOrder(dueDate, rows);
    return;
  }
  const parts = partitionRows(rows);
  const placement = getAutoPlacement(target);
  if (placement === "top") {
    insertDailyRow(parts.topDaily, target);
  } else if (placement === "bottom") {
    insertDailyRow(parts.bottomDaily, target);
  } else {
    const prefix = extractPrefix(target.text);
    if (prefix) {
      let group = parts.prefixGroups.find((item) => item.prefix === prefix);
      if (!group) {
        group = { prefix, rows: [] };
        parts.prefixGroups.push(group);
      }
      group.rows.push(target);
    } else {
      parts.regular.unshift(target);
    }
  }
  writeDayOrder(dueDate, flattenPartitions(parts));
}

function moveTodoByStep(id, direction) {
  const current = todos.find((todo) => todo.id === id);
  if (!current) return;
  const rows = canonicalizeRows(orderedTodosForDate(current.dueDate));
  writeDayOrder(current.dueDate, moveRowByStep(rows, id, direction));
}

function moveTodoToTop(id) {
  const current = todos.find((todo) => todo.id === id);
  if (!current) return;
  if (current.sourceDailyTaskId) {
    moveDailyTaskToEdge(current.sourceDailyTaskId, "top");
    return;
  }
  const rows = canonicalizeRows(orderedTodosForDate(current.dueDate));
  writeDayOrder(current.dueDate, moveNonDailyRowToEdge(rows, id, "top"));
}

function moveTodoToBottom(id) {
  const current = todos.find((todo) => todo.id === id);
  if (!current) return;
  if (current.sourceDailyTaskId) {
    moveDailyTaskToEdge(current.sourceDailyTaskId, "bottom");
    return;
  }
  const rows = canonicalizeRows(orderedTodosForDate(current.dueDate));
  writeDayOrder(current.dueDate, moveNonDailyRowToEdge(rows, id, "bottom"));
}

function updateDailyTaskPlacement(id, placement) {
  moveDailyTaskToEdge(id, placement === "bottom" ? "bottom" : "top");
}

function moveDailyTaskToEdge(id, edge) {
  const task = getDailyTask(id);
  if (!task) return;
  task.placement = edge === "bottom" ? "bottom" : "top";
  task.sortOrder = dailyTaskEdgeSortOrder(task.placement);
  const affectedDates = Array.from(new Set(
    todos
      .filter((todo) => todo.sourceDailyTaskId === id)
      .map((todo) => todo.dueDate)
  ));
  for (const dueDate of affectedDates) {
    const todo = todos.find((item) => item.sourceDailyTaskId === id && item.dueDate === dueDate);
    if (!todo) continue;
    todo.manualSort = 0;
    placeTodoByDefault(dueDate, todo.id);
  }
}

function dailyTaskEdgeSortOrder(placement) {
  const matching = dailyTasks.filter((task) => (task.placement === "bottom" ? "bottom" : "top") === placement);
  if (placement === "bottom") {
    return matching.reduce((max, task) => Math.max(max, Number(task.sortOrder) || 0), -1000) + 1000;
  }
  return matching.reduce((min, task) => Math.min(min, Number(task.sortOrder) || 0), 0) - 1000;
}

function moveNonDailyRowToEdge(rows, id, edge) {
  const row = rows.find((item) => item.id === id);
  if (!row || getAutoPlacement(row)) return rows;
  return extractPrefix(row.text) ? movePrefixRowToEdge(rows, id, edge) : moveRegularRowToEdge(rows, id, edge);
}

function movePrefixRowToEdge(rows, id, edge) {
  const parts = partitionRows(rows);
  const located = locatePrefixRow(parts, id);
  if (!located) return rows;
  const group = parts.prefixGroups[located.groupIndex];
  const [row] = group.rows.splice(located.rowIndex, 1);
  if (edge === "top") {
    group.rows.unshift(row);
    if (located.rowIndex === 0 && located.groupIndex > 0) {
      const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
      parts.prefixGroups.splice(located.groupIndex - 1, 0, movedGroup);
    }
  } else {
    group.rows.push(row);
    if (located.rowIndex === group.rows.length - 1 && located.groupIndex < parts.prefixGroups.length - 1) {
      const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
      parts.prefixGroups.splice(located.groupIndex + 1, 0, movedGroup);
    }
  }
  return flattenPartitions(parts);
}

function moveRegularRowToEdge(rows, id, edge) {
  const parts = partitionRows(rows);
  const index = parts.regular.findIndex((row) => row.id === id);
  if (index < 0) return rows;
  const [row] = parts.regular.splice(index, 1);
  if (edge === "bottom") {
    parts.regular.push(row);
  } else {
    parts.regular.unshift(row);
  }
  return flattenPartitions(parts);
}

function moveRowByStep(rows, id, direction) {
  const parts = partitionRows(rows);
  if (moveDailyRowByStep(parts.topDaily, id, direction) || moveDailyRowByStep(parts.bottomDaily, id, direction)) return flattenPartitions(parts);
  if (movePrefixRowByStep(parts, id, direction)) return flattenPartitions(parts);
  const index = parts.regular.findIndex((row) => row.id === id);
  if (index < 0) return rows;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= parts.regular.length) return rows;
  const [row] = parts.regular.splice(index, 1);
  parts.regular.splice(targetIndex, 0, row);
  return flattenPartitions(parts);
}

function moveDailyRowByStep(rows, id, direction) {
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return false;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= rows.length) return false;
  const [row] = rows.splice(index, 1);
  rows.splice(targetIndex, 0, row);
  return true;
}

function movePrefixRowByStep(parts, id, direction) {
  const located = locatePrefixRow(parts, id);
  if (!located) return false;
  const group = parts.prefixGroups[located.groupIndex];
  if (direction === "up") {
    if (located.rowIndex > 0) {
      const [row] = group.rows.splice(located.rowIndex, 1);
      group.rows.splice(located.rowIndex - 1, 0, row);
      return true;
    }
    if (located.groupIndex > 0) {
      const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
      parts.prefixGroups.splice(located.groupIndex - 1, 0, movedGroup);
      return true;
    }
    return false;
  }
  if (located.rowIndex < group.rows.length - 1) {
    const [row] = group.rows.splice(located.rowIndex, 1);
    group.rows.splice(located.rowIndex + 1, 0, row);
    return true;
  }
  if (located.groupIndex < parts.prefixGroups.length - 1) {
    const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
    parts.prefixGroups.splice(located.groupIndex + 1, 0, movedGroup);
    return true;
  }
  return false;
}

function syncTodayTodoFromCheckin(id, checked) {
  if (checked) {
    const todo = todos.find((item) => item.sourceDailyTaskId === id && item.instanceDate === TODAY);
    if (!todo) return;
    completedDailyTodos.set(completedTodoKey(id, TODAY), todo);
    todos = todos.filter((item) => item.id !== todo.id);
    return;
  }

  const existing = todos.find((item) => item.sourceDailyTaskId === id && item.instanceDate === TODAY);
  if (existing) return;
  const todo = completedDailyTodos.get(completedTodoKey(id, TODAY));
  if (todo) {
    todos.push(todo);
    placeTodoByDefault(todo.dueDate, todo.id);
  }
}

function completedTodoKey(id, date) {
  return `${id}:${date}`;
}

function dailyTasksWithStats() {
  return dailyTasks.map((task) => {
    const startDate = task.startDate || TODAY;
    const checkins = Array.from(dailyCheckins[task.id] || [])
      .filter((date) => date >= startDate && date <= TODAY)
      .sort();
    const totalCount = Math.max(0, daysBetween(startDate, TODAY) + 1);
    const completedCount = new Set(checkins).size;
    const completionPercent = totalCount > 0 ? Number(((completedCount / totalCount) * 100).toFixed(2)) : 0;
    return {
      ...task,
      startDate,
      checkins,
      completedCount,
      totalCount,
      completionPercent,
    };
  });
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

async function firstTodoText(page, dueDate) {
  return page.locator(`.day[data-date="${dueDate}"] .todo .todo-text`).first().evaluate((node) => node.textContent || "");
}

async function todoTextsFor(page, dueDate) {
  return page.locator(`.day[data-date="${dueDate}"] .todo .todo-text`).evaluateAll((nodes) => nodes.map((node) => node.textContent || ""));
}

async function expectTodayOrder(page, expected) {
  await page.waitForFunction((expected) => {
    const actual = Array.from(document.querySelectorAll("#todayTodos .workbench-task-label")).map((node) => node.textContent || "");
    return actual.length === expected.length && actual.every((text, index) => text === expected[index]);
  }, expected);
}

async function todayWorkbenchTexts(page) {
  return page.locator("#todayTodos .workbench-task-label").allTextContents();
}

async function createTodayTodo(page, text) {
  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector(".modal-backdrop.open");
  await page.fill("#newText", text);
  await page.locator("#dateSelect").selectOption(TODAY);
  await page.keyboard.press("Enter");
}

async function createAutomaticTodo(page, text) {
  await page.keyboard.down("Alt");
  await page.keyboard.press("KeyN");
  await page.keyboard.up("Alt");
  await page.waitForSelector("#modalBackdrop.open");
  await page.fill("#newText", text);
  await page.locator("#dateSelect").selectOption("daily");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#modalBackdrop.open") && document.querySelector("#status")?.textContent !== "创建中...");
}

function getNextWeekdayDate(dateString, targetDay) {
  const currentDay = new Date(`${dateString}T00:00:00`).getDay();
  const daysUntilNextMonday = currentDay === 0 ? 1 : 8 - currentDay;
  const offsetFromMonday = targetDay === 0 ? 6 : targetDay - 1;
  return addDays(dateString, daysUntilNextMonday + offsetFromMonday);
}

function toLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}
