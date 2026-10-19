const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");

const root = path.resolve(__dirname, "..");
const worker = vm.createContext({ crypto: globalThis.crypto });
vm.runInContext(fs.readFileSync(path.join(__dirname, "todo-worker.js"), "utf8")
  .replace("export default {", "const worker = {"), worker);

// Execute the actual D1 SQL against SQLite, without touching a live database.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
const queries = [];
const db = {
  prepare(sql) {
    let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      async all() {
        const results = sqlite.prepare(sql).all(...values);
        queries.push({ sql, values, results });
        return { results };
      },
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
const plain = (value) => JSON.parse(JSON.stringify(value));
const frontends = ["deploy/index.html", "deploy/todo.html"].map((file) => {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const calls = [];
  const context = vm.createContext({
    state: { today: "2026-10-19", dailyTasks: [], localDailyByTempId: new Map() },
    canWrite: () => true,
    renderWorkbenchDaily: () => {},
    renderCheckin: () => {},
    localId: () => "local-task",
    apiPost: (url, body) => calls.push({ url, body }),
    enqueueMutation: (callback) => callback(),
  });
  for (const name of ["parseDate", "daysBetween", "getDailyTaskStats", "formatDailyTaskStats", "toggleDailyCheckin", "createLocalDailyTask"]) {
    const match = html.match(new RegExp(`    (?:async )?function ${name}\\([^]*?^    }`, "m"));
    assert.ok(match, `${file}: ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return { file, context, calls };
});

(async () => {
  const cases = [
    ["past month", "2026-07-08", "2026-10-19", 19],
    ["first day", "2026-10-01", "2026-10-19", 19],
    ["mid-month", "2026-10-10", "2026-10-19", 10],
    ["created today", "2026-10-19", "2026-10-19", 1],
    ["following day", "2026-10-19", "2026-10-20", 2],
    ["month end", "2026-07-08", "2026-10-31", 31],
    ["next month reset", "2026-10-19", "2026-11-01", 1],
    ["year reset", "2026-10-19", "2027-01-01", 1],
    ["February", "2026-01-01", "2026-02-28", 28],
    ["leap February", "2028-01-01", "2028-02-29", 29],
    ["future task", "2026-10-20", "2026-10-19", 0],
  ];
  for (const [name, startDate, today, total] of cases) {
    sqlite.exec("DELETE FROM daily_task_checkins");
    const monthStart = today.slice(0, 7) + "-01";
    const statsStart = startDate > monthStart ? startDate : monthStart;
    const dates = [...new Set([worker.addDays(monthStart, -1), monthStart, statsStart, today, worker.addDays(today, 1)])];
    for (const date of dates) {
      sqlite.prepare("INSERT INTO daily_task_checkins (daily_task_id, checkin_date) VALUES (?, ?)").run("task", date);
    }
    sqlite.prepare("INSERT INTO daily_task_checkins (daily_task_id, checkin_date) VALUES (?, ?)").run("other-task", today);
    const expected = dates.filter((date) => date >= statsStart && date <= today).sort();
    const [result] = await worker.attachDailyTaskStats(db, [{ id: "task", startDate }], today);
    assert.equal(result.startDate, startDate, `${name}: original start date preserved`);
    assert.equal(result.totalCount, total, name);
    assert.equal(result.completedCount, expected.length, name);
    assert.deepEqual(plain(result.checkins), expected, name);
    assert.equal(result.completionPercent, total ? Number((expected.length / total * 100).toFixed(2)) : 0, name);
    const query = queries.at(-1);
    assert.deepEqual(plain(query.values), [monthStart, today]);
    assert.ok(query.results.every((row) => row.checkinDate >= monthStart && row.checkinDate <= today));
    for (const { file, context } of frontends) {
      context.state.today = today;
      // Cached lifetime counts and duplicate/old/future checkins must not leak into monthly stats.
      const task = { startDate, checkins: [...dates, today], completedCount: 999, totalCount: 1000 };
      const stats = context.getDailyTaskStats(task);
      assert.equal(stats.totalCount, total, `${file}: ${name}`);
      assert.deepEqual(plain(stats.checkins), expected, `${file}: ${name}`);
      assert.equal(stats.completionPercent, result.completionPercent, `${file}: ${name}`);
      assert.equal(context.formatDailyTaskStats(task), `${expected.length}/${total}   ${result.completionPercent.toFixed(2)}%`);
    }
  }
  assert.deepEqual(plain(await worker.attachDailyTaskStats(db, [], "2026-10-19")), []);

  sqlite.exec("DELETE FROM daily_task_checkins");
  sqlite.prepare("INSERT INTO daily_tasks (id, text, start_date) VALUES (?, ?, ?)").run("task", "Daily", "2026-07-08");
  sqlite.prepare("INSERT INTO daily_tasks (id, text, start_date) VALUES (?, ?, ?)").run("new-task", "New", "2026-10-18");
  for (const [id, date] of [["task", "2026-09-30"], ["task", "2026-10-20"], ["new-task", "2026-10-17"]]) {
    const result = await worker.setDailyTaskCheckin(db, id, date, true, "2026-10-19");
    assert.equal(result.error, "date_out_of_range");
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM daily_task_checkins").get().n, 0);
  assert.equal((await worker.setDailyTaskCheckin(db, "task", "2026-10-01", true, "2026-10-19")).ok, true);
  assert.equal((await worker.setDailyTaskCheckin(db, "task", "2026-10-01", false, "2026-10-19")).ok, true);
  assert.equal(sqlite.prepare("SELECT checked FROM daily_task_checkins").get().checked, 0);
  assert.equal((await worker.setDailyTaskCheckin(db, "new-task", "2026-10-19", true, "2026-10-19")).ok, true);
  assert.equal((await worker.setDailyTaskCheckin(db, "new-task", "2026-10-19", false, "2026-10-19")).ok, true);

  // Backfilling from completed todos must also ignore prior months, including moved daily instances.
  for (const [id, dueDate, instanceDate] of [["old", "2026-09-29", "2026-09-29"], ["moved", "2026-10-19", "2026-09-30"], ["current", "2026-10-18", "2026-10-18"], ["future", "2026-10-20", "2026-10-20"]]) {
    sqlite.prepare("INSERT INTO todos (id, text, due_date, source_daily_task_id, completed_at) VALUES (?, 'Daily', ?, 'task', CURRENT_TIMESTAMP)").run(id, dueDate);
    sqlite.prepare("INSERT INTO daily_task_instances (daily_task_id, generated_date, todo_id) VALUES ('task', ?, ?)").run(instanceDate, id);
  }
  sqlite.prepare("INSERT INTO daily_task_checkins (daily_task_id, checkin_date) VALUES ('task', '2026-09-28')").run();
  await worker.syncDailyCheckinsFromCompletedTodos(db, "2026-10-19");
  const storedDates = sqlite.prepare("SELECT checkin_date FROM daily_task_checkins WHERE daily_task_id = 'task' AND checked = 1 ORDER BY checkin_date").all().map((row) => row.checkin_date);
  assert.deepEqual(storedDates, ["2026-09-28", "2026-10-18"], "old data preserved but not backfilled or counted");

  for (const { context, calls, file } of frontends) {
    context.state.today = "2026-10-19";
    const task = context.createLocalDailyTask("Created today");
    assert.equal(task.totalCount, 1, file);
    assert.equal(context.formatDailyTaskStats(task), "0/1   0.00%", file);
    await context.toggleDailyCheckin(task, "2026-10-19", true);
    assert.equal(context.formatDailyTaskStats(task), "1/1   100.00%", file);
    await context.toggleDailyCheckin(task, "2026-10-19", false);
    assert.equal(context.formatDailyTaskStats(task), "0/1   0.00%", file);
    await context.toggleDailyCheckin(task, "2026-09-30", true);
    await context.toggleDailyCheckin(task, "2026-10-20", true);
    assert.equal(calls.length, 2, `${file}: invalid dates never submitted`);
    context.state.today = "2026-10-20";
    assert.equal(context.getDailyTaskStats(task).totalCount, 2, file);
    context.state.today = "2026-11-01";
    assert.equal(context.formatDailyTaskStats(task), "0/1   0.00%", file);
  }
  console.log(`verify: monthly daily stats passed (${cases.length} date cases, both frontend entry points, SQLite queries, check-in guards and optimistic updates)`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => sqlite.close());
