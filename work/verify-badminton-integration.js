const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM counter_items WHERE name = ?")) {
      return this.db.counterItem?.name === this.values[0] && this.db.counterItem.active ? { id: this.db.counterItem.id } : null;
    }
    if (this.sql.includes("FROM integration_counter_records")) {
      const record = this.db.integrations.get(`${this.values[0]}:${this.values[1]}`);
      return record ? { counterRecordId: record } : null;
    }
    return null;
  }

  async run() {
    if (this.sql.startsWith("INSERT OR IGNORE INTO integration_counter_records")) {
      const key = `${this.values[0]}:${this.values[1]}`;
      if (this.db.integrations.has(key)) return { meta: { changes: 0 } };
      this.db.integrations.set(key, this.values[2]);
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("INSERT OR IGNORE INTO counter_records")) {
      if (this.db.records.has(this.values[0])) return { meta: { changes: 0 } };
      this.db.records.set(this.values[0], {
        id: this.values[0],
        itemId: this.values[1],
        recordedDate: this.values[2],
        recordedAt: this.values[3],
      });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith("DELETE FROM integration_counter_records")) {
      this.db.integrations.delete(`${this.values[0]}:${this.values[1]}`);
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  }
}

function makeDb() {
  return {
    counterItem: { id: "badminton", name: "羽毛球", active: 1 },
    integrations: new Map(),
    records: new Map(),
    prepare(sql) { return new Statement(this, sql); },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

const source = fs.readFileSync(path.join(__dirname, "todo-worker.js"), "utf8");
const start = source.indexOf("async function recordBadmintonIntegration");
const end = source.indexOf("async function createCounterItem", start);
const helperStart = source.indexOf("function isDateString");
const helperEnd = source.indexOf("function normalizeStartDate", helperStart);
const recordedAtStart = source.indexOf("function normalizeRecordedAt");
const recordedAtEnd = source.indexOf("function normalizeDailyText", recordedAtStart);
const jsonStart = source.indexOf("function json(payload");
const script = `${source.slice(start, end)}\n${source.slice(helperStart, helperEnd)}\n${source.slice(recordedAtStart, recordedAtEnd)}\n${source.slice(jsonStart)}\nthis.recordBadmintonIntegration = recordBadmintonIntegration;`;
const context = vm.createContext({
  Request,
  Response,
  crypto: globalThis.crypto,
  Date,
  console,
  BADMINTON_COUNTER_ITEM_NAME: "羽毛球",
  BADMINTON_COUNTER_SOURCE: "badminton-session",
  CORS_HEADERS: {},
  ensureSchema: async () => ({}),
  readJson: async (request) => request.json(),
});
vm.runInContext(`${script}\nthis.timingSafeEqualText = (left, right) => left === right;`, context);

async function call(db, token, body) {
  const request = new Request("https://todo.example/api/integrations/badminton/counter", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Badminton-Integration-Token": token,
    },
    body: JSON.stringify(body),
  });
  return context.recordBadmintonIntegration(request, {
    DB: db,
    BADMINTON_COUNTER_INTEGRATION_SECRET: "test-secret",
  });
}

(async () => {
  const unauthorized = await call(makeDb(), "wrong", { sessionId: 1, recordedDate: "2026-09-10" });
  assert.equal(unauthorized.status, 401);

  const browserRequest = new Request("https://todo.example/api/integrations/badminton/counter", {
    method: "POST",
    headers: { origin: "https://example.com", "X-Badminton-Integration-Token": "test-secret" },
    body: JSON.stringify({ sessionId: 1, recordedDate: "2026-09-10" }),
  });
  const browserResponse = await context.recordBadmintonIntegration(browserRequest, {
    DB: makeDb(),
    BADMINTON_COUNTER_INTEGRATION_SECRET: "test-secret",
  });
  assert.equal(browserResponse.status, 403);

  const db = makeDb();
  const created = await call(db, "test-secret", { sessionId: 123, recordedDate: "2026-09-10", recordedAt: "2026-09-10T12:00:00Z" });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { recorded: true, alreadyRecorded: false, recordId: "badminton-session:123" });
  assert.equal(db.records.size, 1);

  const duplicate = await call(db, "test-secret", { sessionId: 123, recordedDate: "2026-09-10" });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).alreadyRecorded, true);
  assert.equal(db.records.size, 1);

  const missing = makeDb();
  missing.counterItem = null;
  const missingResult = await call(missing, "test-secret", { sessionId: 124, recordedDate: "2026-09-10" });
  assert.equal(missingResult.status, 409);
  assert.equal(missing.records.size, 0);

  console.log("verify: badminton counter integration passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
