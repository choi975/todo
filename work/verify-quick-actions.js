const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const today = "2026-11-07";
const plain = (value) => JSON.parse(JSON.stringify(value));
let checks = 0;
function check(actual, expected, message) {
  assert.deepEqual(plain(actual), plain(expected), message);
  checks += 1;
}

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.innerHTML = "";
    this.classes = new Set();
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
  }
  set innerHTML(value) { this._innerHTML = value; this.children = []; }
  get innerHTML() { return this._innerHTML; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => child instanceof Element ? [child, ...child.querySelectorAll(selector)] : []);
    return descendants.filter((child) => selector === ".project-create-button" && child.className === "project-create-button");
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  focus() { this.focused = true; }
  select() { this.selection = [0, this.value.length]; }
  setSelectionRange(start, end) { this.selection = [start, end]; }
  closest(selector) {
    return selector === ".project-create-button, .workbench-title-action" && this.quickAction ? this : null;
  }
}

function harness(file) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const elements = Object.fromEntries(["prefixGroups", "prefixSummary", "completeDailyToday", "modalBackdrop", "newText", "dateSelect", "openNew", "openTodayNew", "openShoppingNew"].map((name) => [name, new Element()]));
  for (const name of ["completeDailyToday", "openTodayNew", "openShoppingNew"]) elements[name].quickAction = true;
  let localCounter = 0;
  const calls = [];
  const queue = [];
  const timers = [];
  const renders = { daily: 0, checkin: 0 };
  const state = {
    today, dailyTasks: [], todos: [], selected: { type: "todo", id: "regular" },
    readOnly: false, editingId: null,
    localTodoByTempId: new Map(), localTodoRealByTempId: new Map(),
  };
  const context = vm.createContext({
    state, els: elements, SHOPPING_GROUP: "__shopping__",
    document: { createElement: (tag) => new Element(tag), activeElement: null },
    window: { setTimeout: (callback) => timers.push(callback) },
    sortTodos: (a, b) => Number(a.sortOrder) - Number(b.sortOrder),
    localId: () => `local-heading-${++localCounter}`,
    todoSelection: (id) => ({ type: "todo", id }),
    render: () => {}, setStatus: () => {},
    renderTodo: (todo, options) => ({ todo, options }),
    appendWorkbenchEmpty: (element, text) => { element.emptyText = text; },
    renderDateOptions: () => { elements.dateSelect.value = state.today; },
    renderWorkbenchDaily: () => { renders.daily += 1; context.updateDailyCompletionAction(); },
    renderCheckin: () => { renders.checkin += 1; },
    isCompletedOpen: () => false, isCounterOpen: () => false, isCheckinOpen: () => false,
    isCounterItemOpen: () => false, isCounterRecordOpen: () => false,
    isTextEntryTarget: () => false,
    activateSelected: () => calls.push({ unwantedSelectedActivation: true }),
    enqueueMutation: (run, options) => { queue.push({ run, ...options }); return true; },
    apiPost: (url, body) => { calls.push({ url, body: plain(body) }); return { ok: true }; },
  });
  for (const name of ["canWrite", "prefixInfo", "prefixGroupsForWorkbench", "renderWorkbenchPrefixes", "openModal", "closeModal", "submitNewItem", "createLocalTodo", "isNewModalOpen", "parseDate", "daysBetween", "getDailyTaskStats", "normalizeTodoText", "parseAutomaticNewItem", "incompleteDailyTasksToday", "updateDailyCompletionAction", "completeDailyTasksToday", "toggleDailyCheckin", "handleKeys", "updateInteractionState"]) {
    const match = html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?^    }`, "m"));
    assert.ok(match, `${file}: ${name} exists`);
    vm.runInContext(match[0], context);
  }
  check(/<h2 id="dailyHomeTitle"><button[^>]*id="completeDailyToday"[^>]*type="button"[^>]*disabled>每日任务<\/button><\/h2>/.test(html), true, `${file}: heading remains semantic and initially disabled`);
  check(html.includes('els.completeDailyToday.addEventListener("click", completeDailyTasksToday);'), true, `${file}: daily heading click is wired`);
  for (const [headingId, buttonId, label] of [["workbenchTodayTitle", "openTodayNew", "今天"], ["shoppingTitle", "openShoppingNew", "购物清单"]]) {
    check(new RegExp(`<h2 id="${headingId}"><button[^>]*class="workbench-title-action"[^>]*id="${buttonId}"[^>]*type="button"[^>]*aria-label="[^\"]+"[^>]*disabled>${label}<\/button><\/h2>`).test(html), true, `${file}: ${label} is a semantic, initially disabled heading button`);
    const wiring = html.split("\n").find((line) => line.startsWith(`    els.${buttonId}.addEventListener("click",`));
    assert.ok(wiring, `${file}: ${label} click handler is wired`);
    vm.runInContext(wiring, context);
  }
  return { file, html, context, state, elements, calls, queue, renders, runTimers: () => { while (timers.length) timers.shift()(); } };
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
  const db = {
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async all() { return { results: sqlite.prepare(sql).all(...values) }; },
        async first() { return sqlite.prepare(sql).get(...values) || null; },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        },
      };
      return statement;
    },
    async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  };
  const worker = vm.createContext({ crypto: globalThis.crypto });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "todo-worker.js"), "utf8").replace("export default {", "const worker = {"), worker);
  return { sqlite, db, worker };
}

async function verifyCreationHeadings(h) {
  const { file, context, state, elements, queue, calls } = h;
  const { sqlite, db, worker } = database();
  const originalApiPost = context.apiPost;
  context.apiPost = async (url, body) => {
    calls.push({ url, body: plain(body) });
    assert.equal(url, "/api/todos");
    return worker.createTodo(db, body.text, body.dueDate, body.today);
  };
  try {
    context.updateInteractionState();
    check([elements.openTodayNew.disabled, elements.openShoppingNew.disabled], [false, false], `${file}: both headings work even when their lists are empty`);
    elements.newText.value = "COUNT：旧项目草稿";
    elements.dateSelect.value = "daily";
    elements.openTodayNew.listeners.click();
    h.runTimers();
    check([elements.newText.value, elements.newText.selection, elements.newText.focused, elements.dateSelect.value], ["", [0, 0], true, today], `${file}: Today opens a blank ordinary task for today's date`);
    check(elements.modalBackdrop.classList.contains("open"), true, `${file}: Today opens the creation dialog`);
    elements.newText.value = "安装除湿机";
    let prevented = false;
    await context.submitNewItem({ preventDefault() { prevented = true; } });
    check([prevented, queue.length, state.todos.at(-1).text, state.todos.at(-1).dueDate], [true, 1, "安装除湿机", today], `${file}: Today submits an ordinary task via the existing creation path`);
    await queue.shift().run();
    check(sqlite.prepare("SELECT text, due_date AS dueDate FROM todos WHERE text = '安装除湿机'").get(), { text: "安装除湿机", dueDate: today }, `${file}: ordinary creation persists with today's date`);

    elements.newText.value = "TODO：旧项目草稿";
    elements.dateSelect.value = "counter";
    elements.openShoppingNew.listeners.click();
    h.runTimers();
    check([elements.newText.value, elements.newText.selection, elements.newText.focused, elements.dateSelect.value], ["买", [1, 1], true, "__shopping__"], `${file}: Shopping pre-fills exactly 买 with caret at end and selects the shopping list`);
    check(elements.modalBackdrop.classList.contains("open"), true, `${file}: Shopping opens the creation dialog`);
    elements.newText.value += "洗发水";
    await context.submitNewItem({ preventDefault() {} });
    check([queue.length, state.todos.at(-1).text, state.todos.at(-1).dueDate], [1, "买洗发水", "__shopping__"], `${file}: shopping creation appears in the shopping column immediately`);
    await queue.shift().run();
    check(sqlite.prepare("SELECT text, due_date AS dueDate FROM todos WHERE text = '买洗发水'").get(), { text: "买洗发水", dueDate: "__shopping__" }, `${file}: shopping creation persists in the correct group`);
    check(calls.map(({ body }) => body), [{ text: "安装除湿机", dueDate: today, today }, { text: "买洗发水", dueDate: "__shopping__", today }], `${file}: heading creation posts exact text and targets`);

    elements.openShoppingNew.listeners.click();
    h.runTimers();
    elements.newText.value += "未提交的购物草稿";
    context.closeModal({ returnFocus: false });
    elements.openTodayNew.listeners.click();
    h.runTimers();
    check([elements.newText.value, elements.dateSelect.value], ["", today], `${file}: Today does not inherit shopping text or the shopping target`);
    context.closeModal({ returnFocus: false });
    state.today = "2026-11-08";
    elements.openTodayNew.listeners.click();
    h.runTimers();
    check(elements.dateSelect.value, state.today, `${file}: Today uses the current application date rather than a hard-coded date`);
    context.closeModal({ returnFocus: false });
    state.today = today;

    state.readOnly = true;
    context.updateInteractionState();
    check([elements.openTodayNew.disabled, elements.openShoppingNew.disabled], [true, true], `${file}: loading/read-only mode disables both new headings`);
    elements.newText.value = "保留只读草稿";
    for (const id of ["openTodayNew", "openShoppingNew"]) {
      elements[id].listeners.click();
      h.runTimers();
      check([elements.newText.value, elements.modalBackdrop.classList.contains("open"), queue.length], ["保留只读草稿", false, 0], `${file}: ${id} is also guarded against programmatic read-only clicks`);
    }
    state.readOnly = false;
    context.updateInteractionState();
    check([elements.openTodayNew.disabled, elements.openShoppingNew.disabled], [false, false], `${file}: headings re-enable after synchronization`);
    for (const id of ["openTodayNew", "openShoppingNew"]) {
      for (const key of [" ", "Enter"]) {
        let prevented = false;
        context.handleKeys({ key, target: elements[id], preventDefault() { prevented = true; } });
        check([prevented, calls.some((call) => call.unwantedSelectedActivation)], [false, false], `${file}: native ${JSON.stringify(key)} on ${id} is not hijacked by completion shortcuts`);
      }
    }
  } finally {
    context.apiPost = originalApiPost;
    sqlite.close();
    state.today = today;
    state.readOnly = false;
    state.todos = [];
    calls.length = 0;
    queue.length = 0;
  }
}

(async () => {
  for (const file of ["deploy/index.html", "deploy/todo.html"]) {
    const h = harness(file);
    const { context, state, elements } = h;
    await verifyCreationHeadings(h);
    state.todos = ["TODO", "接龙", "COUNT", "较长的项目名称"].map((name, index) => ({ id: `project-${index}`, text: `${name}：现有事项`, dueDate: today, sortOrder: index }));
    context.renderWorkbenchPrefixes();
    check(elements.prefixGroups.children.length, 4, `${file}: every project has an action`);
    for (let index = 0; index < state.todos.length; index += 1) {
      const name = context.prefixInfo(state.todos[index]).label;
      const button = elements.prefixGroups.children[index].children[0].children[0];
      check([button.tagName, button.type, button.disabled, button.textContent], ["BUTTON", "button", false, name], `${file}: ${name} is a native button`);
      check(button.attributes["aria-label"], `新建 ${name} 项目事项`, `${file}: project action has an accessible name`);
      elements.newText.value = "旧的草稿";
      button.listeners.click();
      h.runTimers();
      check([elements.newText.value, elements.newText.selection, elements.newText.focused, elements.dateSelect.value], [`${name}：`, [name.length + 1, name.length + 1], true, today], `${file}: ${name} prefill focuses caret after full-width colon`);
      const typed = elements.newText.value + "新增事项";
      check(context.parseAutomaticNewItem(typed), { type: "", dueDate: "", text: typed }, `${file}: project prefix stays an ordinary todo`);
      check(context.prefixInfo({ text: typed, dueDate: today }).key, name.toLocaleLowerCase(), `${file}: new task stays in its project`);
      context.closeModal({ returnFocus: false });
    }
    elements.newText.value = "保留普通新建草稿";
    context.openModal({ type: "click" });
    h.runTimers();
    check([elements.newText.value, elements.newText.selection], ["保留普通新建草稿", [0, "保留普通新建草稿".length]], `${file}: ordinary New button keeps existing draft/select behavior`);
    context.closeModal({ returnFocus: false });
    elements.newText.focused = false;
    context.openModal({ projectName: "TODO" });
    context.closeModal({ returnFocus: false });
    h.runTimers();
    check(elements.newText.focused, false, `${file}: a closed dialog cannot steal focus from a deferred callback`);

    state.readOnly = true;
    elements.newText.value = "只读草稿";
    context.openModal({ projectName: "TODO" });
    h.runTimers();
    check([elements.newText.value, elements.modalBackdrop.classList.contains("open")], ["只读草稿", false], `${file}: read-only project creation is guarded`);
    elements.prefixGroups.children = [];
    context.renderWorkbenchPrefixes();
    check(elements.prefixGroups.children.every((section) => section.children[0].children[0].disabled), true, `${file}: read-only project buttons are disabled`);
    state.readOnly = false;
    state.dailyTasks = [
      { id: "already", text: "已完成", startDate: "2026-07-01", checkins: ["2026-11-03", today] },
      { id: "pending", text: "未完成", startDate: "2026-07-01", checkins: ["2026-10-31", "2026-11-04", "2026-11-04"] },
      { id: "new", text: "今日新增", startDate: today },
      { id: "future", text: "明天开始", startDate: "2026-11-08", checkins: [] },
    ];
    context.updateDailyCompletionAction();
    check(elements.completeDailyToday.disabled, false, `${file}: unfinished daily tasks enable bulk action`);
    context.completeDailyTasksToday();
    check(h.queue.length, 2, `${file}: only today's two eligible unfinished tasks are queued`);
    check(h.renders, { daily: 1, checkin: 1 }, `${file}: bulk completion renders each view only once`);
    check(state.dailyTasks.map((task) => task.checkins), [["2026-11-03", today], ["2026-11-04", today], [today], []], `${file}: today is checked without changing already-complete or future tasks`);
    check([state.dailyTasks[1].completedCount, state.dailyTasks[1].totalCount, state.dailyTasks[1].completionPercent], [2, 7, 28.57], `${file}: optimistic monthly stats stay correct`);
    check(elements.completeDailyToday.disabled, true, `${file}: completed bulk action becomes disabled`);
    context.completeDailyTasksToday();
    check([h.queue.length, h.renders], [2, { daily: 1, checkin: 1 }], `${file}: repeated clicks never uncheck or duplicate writes`);

    const { sqlite, db, worker } = database();
    try {
      for (const task of state.dailyTasks) {
        sqlite.prepare("INSERT INTO daily_tasks (id, text, start_date) VALUES (?, ?, ?)").run(task.id, task.text, task.startDate);
        sqlite.prepare("INSERT INTO todos (id, text, due_date, source_daily_task_id) VALUES (?, ?, ?, ?)").run(`todo-${task.id}`, task.text, task.id === "future" ? "2026-11-08" : today, task.id);
      }
      sqlite.prepare("INSERT INTO daily_task_checkins (daily_task_id, checkin_date) VALUES ('pending', '2026-10-31')").run();
      sqlite.prepare("INSERT INTO daily_task_checkins (daily_task_id, checkin_date) VALUES ('already', ?)").run(today);
      sqlite.prepare("INSERT INTO todos (id, text, due_date) VALUES ('regular', '普通任务', ?)").run(today);
      context.apiPost = async (url, body) => {
        h.calls.push({ url, body: plain(body) });
        assert.equal(url, "/api/daily-tasks/checkin");
        return worker.setDailyTaskCheckin(db, body.id, body.date, body.checked, body.today);
      };
      for (const mutation of h.queue) check(await mutation.run(), { ok: true }, `${file}: existing Worker endpoint accepts bulk member`);
      check(h.calls.map(({ body }) => body), [{ id: "pending", date: today, checked: true, today }, { id: "new", date: today, checked: true, today }], `${file}: only true check-ins for today are posted`);
      check(sqlite.prepare("SELECT daily_task_id AS id FROM daily_task_checkins WHERE checkin_date = ? AND checked = 1 ORDER BY id").all(today).map(({ id }) => id), ["already", "new", "pending"], `${file}: today's check-ins persist in SQLite`);
      check(sqlite.prepare("SELECT id FROM todos WHERE completed_at IS NOT NULL ORDER BY id").all().map(({ id }) => id), ["todo-new", "todo-pending"], `${file}: linked today's todos complete, regular/future tasks do not`);
      check(sqlite.prepare("SELECT COUNT(*) AS count FROM daily_task_checkins WHERE checkin_date = '2026-10-31'").get().count, 1, `${file}: historical check-in records remain untouched`);
    } finally { sqlite.close(); }

    h.queue.length = 0;
    state.today = "2026-11-08";
    state.readOnly = true;
    context.completeDailyTasksToday();
    check(h.queue.length, 0, `${file}: read-only bulk completion never queues writes`);
    state.readOnly = false;
    context.completeDailyTasksToday();
    check(h.queue.length, 4, `${file}: the next day checks all four eligible tasks, including newly active task`);
    h.queue.length = 0;
    state.dailyTasks = [];
    context.updateInteractionState();
    context.completeDailyTasksToday();
    check([elements.completeDailyToday.disabled, h.queue.length], [true, 0], `${file}: empty daily list is disabled and a no-op`);
    for (const eventKey of [" ", "Enter"]) {
      const target = new Element("button");
      target.quickAction = true;
      let prevented = false;
      context.handleKeys({ key: eventKey, target, preventDefault: () => { prevented = true; } });
      check([prevented, h.calls.some((call) => call.unwantedSelectedActivation)], [false, false], `${file}: native ${JSON.stringify(eventKey)} on heading buttons does not complete the selected task`);
    }
  }
  console.log(`verify: quick actions passed (${checks} checks; both frontend entry points, project/Today/Shopping prefill and caret, actual ordinary/shopping creation, daily batching/idempotence/date/read-only guards, native keyboard behavior, real SQLite persistence)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
