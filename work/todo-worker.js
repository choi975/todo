const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Todo-Session",
  "Access-Control-Max-Age": "86400",
};

let cachedSchema = null;
const SHOPPING_DUE_DATE = "__shopping__";
const DAILY_COUNTER_START_DATE = "2026-07-08";
const DAILY_TASK_PREFIX = "（每日任务）";
const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const AUTH_MAX_FAILED_ATTEMPTS = 5;
const AUTH_LOCK_MS = 10 * 60 * 1000;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, "") || "/";

      if (request.method === "POST" && path === "/api/auth/login") {
        return await login(request, env);
      }

      if (path.startsWith("/api/")) {
        const session = await requireSession(request, env);
        if (!session.ok) return session.response;
      }

      if (request.method === "GET" && path === "/api/state") {
        const today = normalizedDate(url.searchParams.get("today"));
        const days = clampNumber(Number(url.searchParams.get("days") || 21), 6, 90);
        return json(await getState(env.DB, today, days));
      }

      if (request.method === "GET" && path === "/api/completed") {
        const today = normalizedDate(url.searchParams.get("today"));
        const limit = clampNumber(Number(url.searchParams.get("limit") || 100), 1, 100);
        return json(await getCompletedTodos(env.DB, today, limit));
      }

      if (request.method === "GET" && path === "/api/counters") {
        const today = normalizedDate(url.searchParams.get("today"));
        const from = isDateString(url.searchParams.get("from")) ? url.searchParams.get("from") : today;
        const to = isDateString(url.searchParams.get("to")) ? url.searchParams.get("to") : today;
        return json(await getCounterState(env.DB, from <= to ? from : to, from <= to ? to : from));
      }

      if (request.method === "POST" && path === "/api/todos") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        const text = cleanText(body.text);
        const dueDate = normalizedDueDate(body.dueDate);
        if (!text) return json({ error: "empty_text" }, 400);
        return json(await createTodo(env.DB, text, dueDate, today));
      }

      if (request.method === "POST" && path === "/api/daily-tasks") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        const days = clampNumber(Number(body.days || 31), 1, 90);
        const text = cleanText(body.text);
        if (!text) return json({ error: "empty_text" }, 400);
        return json(await createDailyTask(env.DB, text, today, days));
      }

      if (request.method === "POST" && path === "/api/daily-tasks/update") {
        const body = await readJson(request);
        const text = cleanText(body.text);
        if (!text) return json({ error: "empty_text" }, 400);
        return json(await updateDailyTask(env.DB, String(body.id || ""), text));
      }

      if (request.method === "POST" && path === "/api/counter-items") {
        const body = await readJson(request);
        return json(await createCounterItem(env.DB, body));
      }

      if (request.method === "POST" && path === "/api/counter-items/update") {
        const body = await readJson(request);
        return json(await updateCounterItem(env.DB, body));
      }

      if (request.method === "POST" && path === "/api/counter-items/archive") {
        const body = await readJson(request);
        return json(await archiveCounterItem(env.DB, String(body.id || "")));
      }

      if (request.method === "POST" && path === "/api/counter-records") {
        const body = await readJson(request);
        return json(await createCounterRecord(env.DB, body));
      }

      if (request.method === "POST" && path === "/api/counter-records/delete") {
        const body = await readJson(request);
        return json(await deleteCounterRecord(env.DB, String(body.id || "")));
      }

      if (request.method === "POST" && path === "/api/daily-tasks/delete") {
        const body = await readJson(request);
        return json(await deleteDailyTask(env.DB, String(body.id || "")));
      }

      if (request.method === "POST" && path === "/api/todos/complete") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        return json(await completeTodo(env.DB, String(body.id || ""), today));
      }

      if (request.method === "POST" && path === "/api/todos/restore") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        return json(await restoreTodo(env.DB, String(body.id || ""), today));
      }

      if (request.method === "POST" && path === "/api/todos/update") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        const text = cleanText(body.text);
        if (!text) return json({ error: "empty_text" }, 400);
        return json(await updateTodoText(env.DB, String(body.id || ""), text, today));
      }

      if (request.method === "POST" && path === "/api/todos/top") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        return json(await moveTodoToEdge(env.DB, String(body.id || ""), "top", today));
      }

      if (request.method === "POST" && path === "/api/todos/bottom") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        return json(await moveTodoToEdge(env.DB, String(body.id || ""), "bottom", today));
      }

      if (request.method === "POST" && path === "/api/todos/move") {
        const body = await readJson(request);
        const today = normalizedDate(body.today);
        const direction = body.direction === "down" ? "down" : "up";
        return json(await moveTodo(env.DB, String(body.id || ""), direction, today));
      }

      if (request.method === "POST" && path === "/api/daily-tasks/placement") {
        const body = await readJson(request);
        return json(await updateDailyTaskPlacement(env.DB, String(body.id || ""), normalizePlacement(body.placement)));
      }

      if (request.method === "POST" && path === "/api/daily-tasks/checkin") {
        const body = await readJson(request);
        const date = isDateString(body.date) ? body.date : "";
        const today = normalizedDate(body.today);
        if (!date) return json({ error: "invalid_date" }, 400);
        return json(await setDailyTaskCheckin(env.DB, String(body.id || ""), date, Boolean(body.checked), today));
      }

      return json({ error: "not_found" }, 404);
    } catch (error) {
      return json({ error: error.message || "server_error" }, 500);
    }
  },
};

async function getState(db, today, days) {
  const schema = await ensureSchema(db);
  await importLegacyTasks(db, schema);
  await normalizeDailyTaskTexts(db, schema);
  await applyShoppingRules(db, schema);
  await createDailyInstances(db, today, days, schema);
  await syncDailyCheckinsFromCompletedTodos(db, today, schema);
  await rollOverTodos(db, today);
  await applyOrderingRules(db, today, schema);
  await normalizeOrders(db, today);

  const endDate = addDays(today, days - 1);
  const todos = await db.prepare(
    `SELECT id, text, due_date AS dueDate, sort_order AS sortOrder, source_daily_task_id AS sourceDailyTaskId, created_at AS createdAt
     FROM todos
     WHERE completed_at IS NULL AND (due_date = ? OR due_date BETWEEN ? AND ?)
     ORDER BY due_date ASC, sort_order ASC, created_at ASC`
  ).bind(SHOPPING_DUE_DATE, today, endDate).all();

  const dailyTasks = await db.prepare(
    `SELECT CAST(id AS TEXT) AS id, ${schema.dailyTasksTextColumn} AS text, sort_order AS sortOrder, COALESCE(${schema.dailyTasksPlacementColumn}, 'top') AS placement, COALESCE(NULLIF(${schema.dailyTasksStartDateColumn}, ''), ?) AS startDate, created_at AS createdAt
     FROM daily_tasks
     WHERE active = 1
     ORDER BY sort_order ASC, created_at ASC`
  ).bind(DAILY_COUNTER_START_DATE).all();

  return {
    today,
    days,
    todos: todos.results || [],
    dailyTasks: await attachDailyTaskStats(db, dailyTasks.results || [], today),
    completedCount: await countCompletedTodos(db),
    counterItems: await getCounterItemsForDate(db, today),
  };
}

async function getCounterState(db, from, to) {
  await ensureSchema(db);
  const items = await db.prepare(
    `SELECT id, name, kind, unit, increment_value AS incrementValue, color,
            pinned, sort_order AS sortOrder, active, created_at AS createdAt, updated_at AS updatedAt
     FROM counter_items
     WHERE active = 1
     ORDER BY pinned DESC, sort_order ASC, created_at ASC`
  ).all();
  const records = await db.prepare(
    `SELECT id, item_id AS itemId, amount, recorded_date AS recordedDate,
            recorded_at AS recordedAt, created_at AS createdAt
     FROM counter_records
     WHERE recorded_date BETWEEN ? AND ?
     ORDER BY recorded_at DESC, created_at DESC`
  ).bind(from, to).all();
  return { from, to, items: items.results || [], records: records.results || [] };
}

async function getCounterItemsForDate(db, date) {
  await ensureSchema(db);
  const items = await db.prepare(
    `SELECT i.id, i.name, i.kind, i.unit, i.increment_value AS incrementValue,
            i.color, i.pinned, i.sort_order AS sortOrder, i.active,
            COALESCE(SUM(CASE WHEN r.recorded_date = ? THEN r.amount ELSE 0 END), 0) AS todayTotal
     FROM counter_items i
     LEFT JOIN counter_records r ON r.item_id = i.id
     WHERE i.active = 1
     GROUP BY i.id
     ORDER BY i.pinned DESC, i.sort_order ASC, i.created_at ASC`
  ).bind(date).all();
  return items.results || [];
}

async function createCounterItem(db, body) {
  await ensureSchema(db);
  const name = cleanCounterName(body.name);
  if (!name) throw new Error("empty_counter_name");
  const kind = "count";
  const unit = "次";
  const incrementValue = 1;
  const color = normalizeCounterColor(body.color);
  const pinned = body.pinned ? 1 : 0;
  const id = crypto.randomUUID();
  const maxOrder = await db.prepare(`SELECT COALESCE(MAX(sort_order), -1000) AS value FROM counter_items`).first();
  const sortOrder = Number(maxOrder?.value || -1000) + 1000;
  await db.prepare(
    `INSERT INTO counter_items (id, name, kind, unit, increment_value, color, pinned, sort_order, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(id, name, kind, unit, incrementValue, color, pinned, sortOrder).run();
  return { id, name, kind, unit, incrementValue, color, pinned, sortOrder, active: 1 };
}

async function updateCounterItem(db, body) {
  await ensureSchema(db);
  const id = String(body.id || "");
  if (!id) throw new Error("missing_counter_id");
  const name = cleanCounterName(body.name);
  if (!name) throw new Error("empty_counter_name");
  const kind = "count";
  const unit = "次";
  const incrementValue = 1;
  const color = normalizeCounterColor(body.color);
  const pinned = body.pinned ? 1 : 0;
  const result = await db.prepare(
    `UPDATE counter_items
     SET name = ?, kind = ?, unit = ?, increment_value = ?, color = ?, pinned = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND active = 1`
  ).bind(name, kind, unit, incrementValue, color, pinned, id).run();
  if (!result.success || !result.meta?.changes) throw new Error("counter_not_found");
  return { id, name, kind, unit, incrementValue, color, pinned };
}

async function archiveCounterItem(db, id) {
  await ensureSchema(db);
  if (!id) throw new Error("missing_counter_id");
  const result = await db.prepare(
    `UPDATE counter_items SET active = 0, pinned = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND active = 1`
  ).bind(id).run();
  if (!result.success || !result.meta?.changes) throw new Error("counter_not_found");
  return { id, archived: true };
}

async function createCounterRecord(db, body) {
  await ensureSchema(db);
  const itemId = String(body.itemId || "");
  const item = await db.prepare(`SELECT id FROM counter_items WHERE id = ? AND active = 1`).bind(itemId).first();
  if (!item) throw new Error("counter_not_found");
  const amount = 1;
  const recordedDate = normalizedDate(body.recordedDate);
  const recordedAt = normalizeRecordedAt(body.recordedAt);
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO counter_records (id, item_id, amount, recorded_date, recorded_at, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(id, itemId, amount, recordedDate, recordedAt).run();
  return { id, itemId, amount, recordedDate, recordedAt };
}

async function deleteCounterRecord(db, id) {
  await ensureSchema(db);
  if (!id) throw new Error("missing_counter_record_id");
  const result = await db.prepare(`DELETE FROM counter_records WHERE id = ?`).bind(id).run();
  if (!result.success || !result.meta?.changes) throw new Error("counter_record_not_found");
  return { id, deleted: true };
}

async function getCompletedTodos(db, today, limit) {
  const schema = await ensureSchema(db);
  await importLegacyTasks(db, schema);

  const total = await countCompletedTodos(db);
  const rows = await db.prepare(
    `SELECT id, text, due_date AS dueDate, completed_at AS completedAt, created_at AS createdAt
     FROM todos
     WHERE completed_at IS NOT NULL AND source_daily_task_id IS NULL
     ORDER BY completed_at DESC, updated_at DESC, created_at DESC
     LIMIT ?`
  ).bind(limit).all();

  return {
    today,
    total,
    limit,
    todos: rows.results || [],
  };
}

async function countCompletedTodos(db) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS total
     FROM todos
     WHERE completed_at IS NOT NULL AND source_daily_task_id IS NULL`
  ).first();
  return Number(row?.total) || 0;
}

async function createTodo(db, text, dueDate, today) {
  const schema = await ensureSchema(db);
  const id = crypto.randomUUID();
  const effectiveDueDate = dueDate === SHOPPING_DUE_DATE || isShoppingText(text) ? SHOPPING_DUE_DATE : (dueDate < today ? today : dueDate);
  const sortOrder = await nextSortOrder(db, effectiveDueDate);
  await db.prepare(
    `INSERT INTO todos (id, text, due_date, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(id, text, effectiveDueDate, sortOrder).run();
  await placeTodoByDefault(db, effectiveDueDate, id, schema, null, { today, isNew: true });
  return { id };
}

async function createDailyTask(db, text, today, days) {
  const schema = await ensureSchema(db);
  const dailyText = normalizeDailyText(text);
  const dailyOrder = await nextDailySortOrder(db);
  const placement = "top";
  let rawDailyTaskId;
  let sourceDailyTaskId;

  if (schema.dailyTasksIdMode === "integer") {
    const result = await db.prepare(
      `INSERT INTO daily_tasks (${schema.dailyTasksTextColumn}, active, sort_order, ${schema.dailyTasksPlacementColumn}, ${schema.dailyTasksStartDateColumn}, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(dailyText, dailyOrder, placement, today).run();
    rawDailyTaskId = result.meta.last_row_id;
    sourceDailyTaskId = String(rawDailyTaskId);
  } else {
    rawDailyTaskId = crypto.randomUUID();
    sourceDailyTaskId = rawDailyTaskId;
    await db.prepare(
      `INSERT INTO daily_tasks (id, ${schema.dailyTasksTextColumn}, active, sort_order, ${schema.dailyTasksPlacementColumn}, ${schema.dailyTasksStartDateColumn}, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(rawDailyTaskId, dailyText, dailyOrder, placement, today).run();
  }

  const dailyTaskMap = await loadDailyTaskMap(db, schema);
  const todoIds = [];
  const endDate = addDays(today, days - 1);
  for (let dueDate = today; dueDate <= endDate; dueDate = addDays(dueDate, 1)) {
    todoIds.push(await insertDailyInstance(db, schema, rawDailyTaskId, sourceDailyTaskId, dailyText, dueDate, dailyTaskMap));
  }
  return { id: sourceDailyTaskId, todoIds };
}

async function updateDailyTask(db, id, text) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  const rawDailyTaskId = normalizeDailyTaskId(schema, id);
  const dailyText = normalizeDailyText(text);
  const existing = await db.prepare(
    `SELECT CAST(id AS TEXT) AS id
     FROM daily_tasks
     WHERE id = ? AND active = 1`
  ).bind(rawDailyTaskId).first();
  if (!existing) return { ok: false };

  const operations = [
    db.prepare(
      `UPDATE daily_tasks
       SET ${schema.dailyTasksTextColumn} = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND active = 1`
    ).bind(dailyText, rawDailyTaskId),
    db.prepare(
      `UPDATE todos
       SET text = ?, updated_at = CURRENT_TIMESTAMP
       WHERE source_daily_task_id = ? AND completed_at IS NULL`
    ).bind(dailyText, id),
  ];

  if (schema.hasLegacyTasksTable) {
    operations.push(
      db.prepare(
        `UPDATE tasks
         SET title = ?, updated_at = CURRENT_TIMESTAMP
         WHERE daily_task_id = ? AND completed_at IS NULL`
      ).bind(dailyText, rawDailyTaskId)
    );
  }

  await db.batch(operations);
  return { ok: true };
}

async function deleteDailyTask(db, id) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  const rawDailyTaskId = normalizeDailyTaskId(schema, id);

  const operations = [
    db.prepare(
      `UPDATE daily_tasks
       SET active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(rawDailyTaskId),
    db.prepare(
      `DELETE FROM daily_task_instances
       WHERE daily_task_id = ?`
    ).bind(rawDailyTaskId),
    db.prepare(
      `DELETE FROM todos
       WHERE source_daily_task_id = ? AND completed_at IS NULL`
    ).bind(id),
    db.prepare(
      `DELETE FROM daily_task_checkins
       WHERE daily_task_id = ?`
    ).bind(id),
  ];

  if (schema.hasLegacyTasksTable) {
    operations.push(
      db.prepare(
        `DELETE FROM tasks
         WHERE daily_task_id = ? AND completed_at IS NULL`
      ).bind(rawDailyTaskId)
    );
  }

  await db.batch(operations);
  return { ok: true };
}

async function completeTodo(db, id, today) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  const current = await db.prepare(
    `SELECT t.id, t.due_date AS dueDate, t.source_daily_task_id AS sourceDailyTaskId, dti.${schema.dailyInstancesDateColumn} AS instanceDate, COALESCE(NULLIF(dt.${schema.dailyTasksStartDateColumn}, ''), ?) AS startDate
     FROM todos t
     LEFT JOIN daily_task_instances dti ON dti.${schema.dailyInstancesTodoColumn} = t.id
     LEFT JOIN daily_tasks dt ON CAST(dt.id AS TEXT) = t.source_daily_task_id
     WHERE t.id = ? AND t.completed_at IS NULL`
  ).bind(DAILY_COUNTER_START_DATE, id).first();
  if (!current) return { ok: false };

  await db.prepare(
    `UPDATE todos
     SET completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND completed_at IS NULL`
  ).bind(id).run();

  const checkinDate = dailyCheckinDateForTodo(current);
  const startDate = normalizeStartDate(current.startDate);
  if (current.sourceDailyTaskId && checkinDate && checkinDate >= startDate && checkinDate <= today) {
    await markDailyTaskCheckin(db, current.sourceDailyTaskId, checkinDate);
  }
  return { ok: true };
}

async function restoreTodo(db, id, today) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  await importLegacyTasks(db, schema);
  await applyShoppingRules(db, schema);
  await rollOverTodos(db, today);

  const current = await db.prepare(
    `SELECT id, text
     FROM todos
     WHERE id = ? AND completed_at IS NOT NULL AND source_daily_task_id IS NULL`
  ).bind(id).first();
  if (!current) return { ok: false };

  const dueDate = isShoppingText(current.text) ? SHOPPING_DUE_DATE : today;
  const sortOrder = await nextSortOrder(db, dueDate);
  await db.prepare(
    `UPDATE todos
     SET completed_at = NULL, due_date = ?, sort_order = ?, manual_sort = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND completed_at IS NOT NULL AND source_daily_task_id IS NULL`
  ).bind(dueDate, sortOrder, id).run();

  await placeTodoByDefault(db, dueDate, id, schema, null, { today, isNew: true });
  return { ok: true, id, dueDate };
}

async function updateTodoText(db, id, text, today) {
  if (!id || !text) return { ok: false };
  const schema = await ensureSchema(db);
  const current = await db.prepare(
    `SELECT id, due_date AS dueDate, source_daily_task_id AS sourceDailyTaskId
     FROM todos
     WHERE id = ? AND completed_at IS NULL`
  ).bind(id).first();
  if (!current) return { ok: false };

  const nextText = current.sourceDailyTaskId ? normalizeDailyText(text) : text;
  const nextDueDate = !current.sourceDailyTaskId && isShoppingText(nextText)
    ? SHOPPING_DUE_DATE
    : (current.dueDate === SHOPPING_DUE_DATE ? today : current.dueDate);

  await db.prepare(
    `UPDATE todos
     SET text = ?, due_date = ?, manual_sort = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND completed_at IS NULL`
  ).bind(nextText, nextDueDate, id).run();
  await placeTodoByDefault(db, nextDueDate, id, schema, null, { today, isNew: true });
  return { ok: true };
}

async function moveTodo(db, id, direction, today) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  await importLegacyTasks(db, schema);
  await normalizeDailyTaskTexts(db, schema);
  await rollOverTodos(db, today);

  const current = await db.prepare(
    `SELECT id, due_date AS dueDate, source_daily_task_id AS sourceDailyTaskId
     FROM todos
     WHERE id = ? AND completed_at IS NULL`
  ).bind(id).first();
  if (!current) return { ok: false };

  const dailyTaskMap = await loadDailyTaskMap(db, schema);
  const rows = canonicalizeRows(await loadDayRows(db, current.dueDate), dailyTaskMap);
  const currentIndex = rows.findIndex((row) => row.id === id);
  if (currentIndex < 0) return { ok: false };

  const reordered = moveRowByStep(rows, id, direction, dailyTaskMap);
  if (!isSameRowOrder(rows, reordered)) await saveDayRows(db, reordered);
  return { ok: true };
}

async function moveTodoToEdge(db, id, edge, today) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  await importLegacyTasks(db, schema);
  await normalizeDailyTaskTexts(db, schema);
  await applyShoppingRules(db, schema);
  await rollOverTodos(db, today);

  const current = await db.prepare(
    `SELECT id, due_date AS dueDate, source_daily_task_id AS sourceDailyTaskId
     FROM todos
     WHERE id = ? AND completed_at IS NULL`
  ).bind(id).first();
  if (!current) return { ok: false };

  if (current.sourceDailyTaskId) {
    await moveDailyTaskToEdge(db, schema, current.sourceDailyTaskId, edge);
    return { ok: true };
  }

  const dailyTaskMap = await loadDailyTaskMap(db, schema);
  const rows = canonicalizeRows(await loadDayRows(db, current.dueDate), dailyTaskMap);
  const currentIndex = rows.findIndex((row) => row.id === id);
  if (currentIndex < 0) return { ok: false };

  const reordered = moveNonDailyRowToEdge(rows, id, edge, dailyTaskMap);
  if (!isSameRowOrder(rows, reordered)) await saveDayRows(db, reordered);
  return { ok: true };
}

async function updateDailyTaskPlacement(db, id, placement) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  await normalizeDailyTaskTexts(db, schema);
  const rawDailyTaskId = normalizeDailyTaskId(schema, id);
  const existing = await db.prepare(
    `SELECT COALESCE(${schema.dailyTasksPlacementColumn}, 'top') AS placement
     FROM daily_tasks
     WHERE id = ? AND active = 1`
  ).bind(rawDailyTaskId).first();
  if (!existing) return { ok: false };

  const nextOrder = await dailyTaskEdgeSortOrder(db, schema, placement);
  await db.prepare(
    `UPDATE daily_tasks
     SET ${schema.dailyTasksPlacementColumn} = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(placement, nextOrder, rawDailyTaskId).run();

  const rows = await db.prepare(
    `SELECT id, due_date AS dueDate
     FROM todos
     WHERE source_daily_task_id = ? AND completed_at IS NULL
     ORDER BY due_date ASC, sort_order ASC, created_at ASC`
  ).bind(id).all();
  const dailyTaskMap = await loadDailyTaskMap(db, schema);
  const dates = Array.from(new Set((rows.results || []).map((row) => row.dueDate)));
  for (const dueDate of dates) {
    if (dueDate === SHOPPING_DUE_DATE) continue;
    await placeDailyTodoByPlacement(db, dueDate, id, dailyTaskMap);
  }
  return { ok: true };
}

async function moveDailyTaskToEdge(db, schema, sourceDailyTaskId, edge) {
  const placement = edge === "bottom" ? "bottom" : "top";
  const rawDailyTaskId = normalizeDailyTaskId(schema, sourceDailyTaskId);
  const existing = await db.prepare(
    `SELECT CAST(id AS TEXT) AS id
     FROM daily_tasks
     WHERE id = ? AND active = 1`
  ).bind(rawDailyTaskId).first();
  if (!existing) return;

  const nextOrder = await dailyTaskEdgeSortOrder(db, schema, placement);
  await db.prepare(
    `UPDATE daily_tasks
     SET ${schema.dailyTasksPlacementColumn} = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(placement, nextOrder, rawDailyTaskId).run();

  const rows = await db.prepare(
    `SELECT DISTINCT due_date AS dueDate
     FROM todos
     WHERE source_daily_task_id = ? AND completed_at IS NULL
     ORDER BY due_date ASC`
  ).bind(sourceDailyTaskId).all();
  const dailyTaskMap = await loadDailyTaskMap(db, schema);
  for (const row of rows.results || []) {
    if (row.dueDate === SHOPPING_DUE_DATE) continue;
    await placeDailyTodoByPlacement(db, row.dueDate, sourceDailyTaskId, dailyTaskMap);
  }
}

async function dailyTaskEdgeSortOrder(db, schema, placement) {
  if (placement === "bottom") {
    const row = await db.prepare(
      `SELECT COALESCE(MAX(sort_order), -1000) + 1000 AS nextOrder
       FROM daily_tasks
       WHERE active = 1 AND COALESCE(${schema.dailyTasksPlacementColumn}, 'top') = 'bottom'`
    ).first();
    return Number(row?.nextOrder) || 0;
  }

  const row = await db.prepare(
    `SELECT COALESCE(MIN(sort_order), 0) - 1000 AS nextOrder
     FROM daily_tasks
     WHERE active = 1 AND COALESCE(${schema.dailyTasksPlacementColumn}, 'top') = 'top'`
  ).first();
  return Number(row?.nextOrder) || 0;
}

async function setDailyTaskCheckin(db, id, date, checked, today) {
  if (!id) return { ok: false };
  const schema = await ensureSchema(db);
  const rawDailyTaskId = normalizeDailyTaskId(schema, id);
  const existing = await db.prepare(
    `SELECT CAST(id AS TEXT) AS id, COALESCE(NULLIF(${schema.dailyTasksStartDateColumn}, ''), ?) AS startDate
     FROM daily_tasks
     WHERE id = ? AND active = 1`
  ).bind(DAILY_COUNTER_START_DATE, rawDailyTaskId).first();
  if (!existing) return { ok: false };

  const startDate = normalizeStartDate(existing.startDate);
  if (date < startDate || date > today) return { ok: false, error: "date_out_of_range" };

  await setDailyTaskCheckinValue(db, existing.id, date, checked);
  if (date === today) {
    await syncTodayTodoFromCheckin(db, schema, rawDailyTaskId, existing.id, today, checked);
  }
  return { ok: true };
}

async function attachDailyTaskStats(db, tasks, today) {
  if (!tasks.length) return [];
  const checkinRows = await db.prepare(
    `SELECT daily_task_id AS dailyTaskId, checkin_date AS checkinDate
     FROM daily_task_checkins
     WHERE checked = 1 AND checkin_date <= ?
     ORDER BY checkin_date ASC`
  ).bind(today).all();
  const checkinsByTask = new Map();
  for (const row of checkinRows.results || []) {
    if (!checkinsByTask.has(row.dailyTaskId)) checkinsByTask.set(row.dailyTaskId, []);
    checkinsByTask.get(row.dailyTaskId).push(row.checkinDate);
  }

  return tasks.map((task) => {
    const startDate = normalizeStartDate(task.startDate);
    const total = Math.max(0, daysBetween(startDate, today) + 1);
    const checkins = (checkinsByTask.get(task.id) || []).filter((date) => date >= startDate && date <= today);
    const completed = new Set(checkins).size;
    return {
      ...task,
      startDate,
      checkins: Array.from(new Set(checkins)),
      completedCount: completed,
      totalCount: total,
      completionPercent: total > 0 ? Number(((completed / total) * 100).toFixed(2)) : 0,
    };
  });
}

async function syncDailyCheckinsFromCompletedTodos(db, today, schema = null) {
  const resolvedSchema = schema || await ensureSchema(db);
  const rows = await db.prepare(
    `SELECT t.id, t.due_date AS dueDate, t.source_daily_task_id AS sourceDailyTaskId, dti.${resolvedSchema.dailyInstancesDateColumn} AS instanceDate, COALESCE(NULLIF(dt.${resolvedSchema.dailyTasksStartDateColumn}, ''), ?) AS startDate
     FROM todos t
     LEFT JOIN daily_task_instances dti ON dti.${resolvedSchema.dailyInstancesTodoColumn} = t.id
     LEFT JOIN daily_tasks dt ON CAST(dt.id AS TEXT) = t.source_daily_task_id
     WHERE t.completed_at IS NOT NULL AND t.source_daily_task_id IS NOT NULL`
  ).bind(DAILY_COUNTER_START_DATE).all();

  const operations = [];
  for (const row of rows.results || []) {
    const checkinDate = dailyCheckinDateForTodo(row);
    const startDate = normalizeStartDate(row.startDate);
    if (!checkinDate || checkinDate < startDate || checkinDate > today) continue;
    operations.push(
      db.prepare(
        `INSERT OR IGNORE INTO daily_task_checkins (daily_task_id, checkin_date, checked, created_at, updated_at)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(row.sourceDailyTaskId, checkinDate)
    );
  }
  if (operations.length) await db.batch(operations);
}

async function markDailyTaskCheckin(db, id, date) {
  await setDailyTaskCheckinValue(db, id, date, true);
}

async function setDailyTaskCheckinValue(db, id, date, checked) {
  await db.prepare(
    `INSERT INTO daily_task_checkins (daily_task_id, checkin_date, checked, created_at, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(daily_task_id, checkin_date) DO UPDATE SET checked = excluded.checked, updated_at = CURRENT_TIMESTAMP`
  ).bind(id, date, checked ? 1 : 0).run();
}

async function syncTodayTodoFromCheckin(db, schema, rawDailyTaskId, sourceDailyTaskId, today, checked) {
  const instance = await db.prepare(
    `SELECT t.id AS todoId, t.due_date AS dueDate
     FROM todos t
     WHERE t.source_daily_task_id = ? AND (t.due_date = ? OR t.due_date = ?)
     ORDER BY CASE WHEN t.due_date = ? THEN 0 ELSE 1 END, t.created_at ASC
     LIMIT 1`
  ).bind(sourceDailyTaskId, today, SHOPPING_DUE_DATE, today).first();
  if (!instance?.todoId) {
    const fallback = await db.prepare(
      `SELECT ${schema.dailyInstancesTodoColumn} AS todoId
       FROM daily_task_instances
       WHERE daily_task_id = ? AND ${schema.dailyInstancesDateColumn} = ?`
    ).bind(rawDailyTaskId, today).first();
    if (!fallback?.todoId) return;
    instance.todoId = String(fallback.todoId);
    instance.dueDate = today;
  }

  await db.prepare(
    `UPDATE todos
     SET completed_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND source_daily_task_id = ?`
  ).bind(checked ? new Date().toISOString() : null, instance.todoId, sourceDailyTaskId).run();

  if (!checked) {
    await db.prepare(
      `UPDATE todos
       SET manual_sort = 0
     WHERE id = ?`
    ).bind(instance.todoId).run();
    await placeTodoByDefault(db, instance.dueDate || today, instance.todoId, schema, null, { today, isNew: true });
  }
}

async function rollOverTodos(db, today) {
  const overdue = await db.prepare(
    `SELECT id
     FROM todos
     WHERE completed_at IS NULL AND due_date < ? AND source_daily_task_id IS NULL
     ORDER BY due_date ASC, sort_order ASC, created_at ASC`
  ).bind(today).all();

  const rows = overdue.results || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    await db.prepare(
      `UPDATE todos
       SET due_date = ?, manual_sort = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(today, row.id).run();
    await placeTodoByDefault(db, today, row.id, null, null, { today, isRollover: true });
  }
}

async function createDailyInstances(db, today, days, schema = null) {
  const resolvedSchema = schema || await ensureSchema(db);
  const endDate = addDays(today, days - 1);
  const tasks = await db.prepare(
    `SELECT id AS rawId, CAST(id AS TEXT) AS refId, ${resolvedSchema.dailyTasksTextColumn} AS text, sort_order AS sortOrder, COALESCE(${resolvedSchema.dailyTasksPlacementColumn}, 'top') AS placement, COALESCE(NULLIF(${resolvedSchema.dailyTasksStartDateColumn}, ''), ?) AS startDate, created_at AS createdAt
     FROM daily_tasks
     WHERE active = 1
     ORDER BY sort_order ASC, created_at ASC`
  ).bind(DAILY_COUNTER_START_DATE).all();
  const dailyTaskMap = new Map((tasks.results || []).map((task) => [
    task.refId,
    {
      sortOrder: Number(task.sortOrder) || 0,
      placement: normalizePlacement(task.placement),
      createdAt: task.createdAt,
    },
  ]));

  for (const task of tasks.results || []) {
    const generatedDates = await db.prepare(
      `SELECT ${resolvedSchema.dailyInstancesDateColumn} AS generatedDate
       FROM daily_task_instances
       WHERE daily_task_id = ? AND ${resolvedSchema.dailyInstancesDateColumn} BETWEEN ? AND ?
       ORDER BY ${resolvedSchema.dailyInstancesDateColumn} ASC`
    ).bind(task.rawId, today, endDate).all();

    const dateList = (generatedDates.results || []).map((row) => row.generatedDate);
    const existingDates = new Set(dateList);

    const firstDate = maxDate(today, normalizeStartDate(task.startDate));
    for (let dueDate = firstDate; dueDate <= endDate; dueDate = addDays(dueDate, 1)) {
      if (!existingDates.has(dueDate)) {
        await insertDailyInstance(db, resolvedSchema, task.rawId, task.refId, task.text, dueDate, dailyTaskMap);
      }
    }
  }
}

async function normalizeOrders(db, today) {
  const rows = await db.prepare(
    `SELECT id, due_date AS dueDate
     FROM todos
     WHERE completed_at IS NULL AND (due_date = ? OR due_date >= ?)
     ORDER BY due_date ASC, sort_order ASC, created_at ASC`
  ).bind(SHOPPING_DUE_DATE, today).all();

  const updates = [];
  let currentDate = "";
  let order = 0;
  for (const row of rows.results || []) {
    if (row.dueDate !== currentDate) {
      currentDate = row.dueDate;
      order = 0;
    }
    updates.push(db.prepare(`UPDATE todos SET sort_order = ? WHERE id = ?`).bind(order, row.id));
    order += 1000;
  }
  if (updates.length) await db.batch(updates);
}

async function nextSortOrder(db, dueDate) {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1000) + 1000 AS nextOrder
     FROM todos
     WHERE completed_at IS NULL AND due_date = ?`
  ).bind(dueDate).first();
  return row.nextOrder;
}

async function nextDailySortOrder(db) {
  const row = await db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1000) + 1000 AS nextOrder
     FROM daily_tasks
     WHERE active = 1`
  ).first();
  return row.nextOrder;
}

async function insertDailyInstance(db, schema, rawDailyTaskId, sourceDailyTaskId, text, dueDate, dailyTaskMap = null) {
  const todoId = crypto.randomUUID();
  const dailyText = normalizeDailyText(text);
  const effectiveDueDate = dueDate;
  const todoOrder = await nextSortOrder(db, effectiveDueDate);
  await db.batch([
    db.prepare(
      `INSERT INTO todos (id, text, due_date, sort_order, source_daily_task_id, manual_sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(todoId, dailyText, effectiveDueDate, todoOrder, sourceDailyTaskId),
    db.prepare(
      `INSERT INTO daily_task_instances (daily_task_id, ${schema.dailyInstancesDateColumn}, ${schema.dailyInstancesTodoColumn}, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(rawDailyTaskId, dueDate, todoId),
  ]);
  await placeTodoByDefault(db, effectiveDueDate, todoId, schema, dailyTaskMap);
  return todoId;
}

async function getSchemaInfo(db) {
  if (cachedSchema) return cachedSchema;

  const [todosInfo, dailyTasksInfo, dailyTaskInstancesInfo, dailyTaskCheckinsInfo, tablesInfo] = await Promise.all([
    db.prepare(`PRAGMA table_info(todos)`).all(),
    db.prepare(`PRAGMA table_info(daily_tasks)`).all(),
    db.prepare(`PRAGMA table_info(daily_task_instances)`).all(),
    db.prepare(`PRAGMA table_info(daily_task_checkins)`).all(),
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all(),
  ]);

  const todosColumns = new Map((todosInfo.results || []).map((column) => [column.name, column]));
  const dailyTasksColumns = new Map((dailyTasksInfo.results || []).map((column) => [column.name, column]));
  const dailyTaskInstancesColumns = new Map((dailyTaskInstancesInfo.results || []).map((column) => [column.name, column]));
  const dailyTaskCheckinsColumns = new Map((dailyTaskCheckinsInfo.results || []).map((column) => [column.name, column]));
  const tableNames = new Set((tablesInfo.results || []).map((row) => row.name));

  cachedSchema = {
    hasTodosTable: tableNames.has("todos"),
    hasDailyTasksTable: tableNames.has("daily_tasks"),
    hasDailyTaskInstancesTable: tableNames.has("daily_task_instances"),
    dailyTasksTextColumn: dailyTasksColumns.has("text") ? "text" : "title",
    dailyTasksPlacementColumn: dailyTasksColumns.has("placement") ? "placement" : "placement",
    dailyTasksStartDateColumn: "start_date",
    dailyTasksIdMode: String(dailyTasksColumns.get("id")?.type || "").toUpperCase().includes("INT") ? "integer" : "text",
    dailyInstancesDateColumn: dailyTaskInstancesColumns.has("generated_date") ? "generated_date" : "instance_date",
    dailyInstancesTodoColumn: dailyTaskInstancesColumns.has("todo_id") ? "todo_id" : "task_id",
    hasLegacyTasksTable: tableNames.has("tasks"),
    hasSourceDailyTaskId: todosColumns.has("source_daily_task_id"),
    hasDailyTasksPlacement: dailyTasksColumns.has("placement"),
    hasDailyTasksStartDate: dailyTasksColumns.has("start_date"),
    hasTodoManualSort: todosColumns.has("manual_sort"),
    hasDailyTaskCheckins: tableNames.has("daily_task_checkins"),
    hasDailyTaskCheckinsChecked: dailyTaskCheckinsColumns.has("checked"),
    hasCounterItemsTable: tableNames.has("counter_items"),
    hasCounterRecordsTable: tableNames.has("counter_records"),
  };

  return cachedSchema;
}

async function ensureSchema(db) {
  const schema = await getSchemaInfo(db);
  if (!schema.hasDailyTasksTable || !schema.hasTodosTable || !schema.hasDailyTaskInstancesTable || !schema.hasDailyTaskCheckins || !schema.hasCounterItemsTable || !schema.hasCounterRecordsTable) {
    await ensureBaseTables(db);
    cachedSchema = null;
    return ensureSchema(db);
  }

  const statements = [];
  if (!schema.hasDailyTasksPlacement) {
    statements.push(`ALTER TABLE daily_tasks ADD COLUMN placement TEXT NOT NULL DEFAULT 'top'`);
  }
  if (!schema.hasDailyTasksStartDate) {
    statements.push(`ALTER TABLE daily_tasks ADD COLUMN start_date TEXT`);
  }
  if (!schema.hasTodoManualSort) {
    statements.push(`ALTER TABLE todos ADD COLUMN manual_sort INTEGER NOT NULL DEFAULT 0`);
  }
  if (!schema.hasDailyTaskCheckins) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS daily_task_checkins (
        daily_task_id TEXT NOT NULL,
        checkin_date TEXT NOT NULL,
        checked INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (daily_task_id, checkin_date)
      )`
    );
  }
  if (schema.hasDailyTaskCheckins && !schema.hasDailyTaskCheckinsChecked) {
    statements.push(`ALTER TABLE daily_task_checkins ADD COLUMN checked INTEGER NOT NULL DEFAULT 1`);
  }
  if (!schema.hasCounterItemsTable) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS counter_items (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'count',
        unit TEXT NOT NULL DEFAULT '次',
        increment_value REAL NOT NULL DEFAULT 1,
        color TEXT NOT NULL DEFAULT '#256d85',
        pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
  }
  if (!schema.hasCounterRecordsTable) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS counter_records (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        amount REAL NOT NULL,
        recorded_date TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`
    );
  }
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  if (statements.length) cachedSchema = null;
  await db.prepare(
    `UPDATE daily_tasks
     SET start_date = ?
     WHERE start_date IS NULL OR start_date = ''`
  ).bind(DAILY_COUNTER_START_DATE).run();
  await db.prepare(
    `UPDATE counter_items
     SET kind = 'count', unit = '次', increment_value = 1, updated_at = CURRENT_TIMESTAMP
     WHERE kind <> 'count' OR unit <> '次' OR increment_value <> 1`
  ).run();
  await db.prepare(`UPDATE counter_records SET amount = 1 WHERE amount <> 1`).run();
  return statements.length ? getSchemaInfo(db) : schema;
}

async function ensureBaseTables(db) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      due_date TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      source_daily_task_id TEXT,
      manual_sort INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS daily_tasks (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      placement TEXT NOT NULL DEFAULT 'top',
      start_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS daily_task_instances (
      daily_task_id TEXT NOT NULL,
      generated_date TEXT NOT NULL,
      todo_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (daily_task_id, generated_date)
    )`,
    `CREATE TABLE IF NOT EXISTS daily_task_checkins (
      daily_task_id TEXT NOT NULL,
      checkin_date TEXT NOT NULL,
      checked INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (daily_task_id, checkin_date)
    )`,
    `CREATE TABLE IF NOT EXISTS counter_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'count',
      unit TEXT NOT NULL DEFAULT '次',
      increment_value REAL NOT NULL DEFAULT 1,
      color TEXT NOT NULL DEFAULT '#256d85',
      pinned INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS counter_records (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      amount REAL NOT NULL,
      recorded_date TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  ];
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function importLegacyTasks(db, schema = null) {
  const resolvedSchema = schema || await ensureSchema(db);
  if (!resolvedSchema.hasLegacyTasksTable || !resolvedSchema.hasSourceDailyTaskId) return;

  await db.prepare(
    `INSERT OR IGNORE INTO todos (id, text, due_date, sort_order, source_daily_task_id, completed_at, created_at, updated_at)
     SELECT
       'legacy-task-' || CAST(id AS TEXT),
       title,
       due_date,
       sort_order,
       CASE WHEN daily_task_id IS NULL THEN NULL ELSE CAST(daily_task_id AS TEXT) END,
       completed_at,
       created_at,
       updated_at
     FROM tasks`
  ).run();
}

async function loadDayRows(db, dueDate) {
  const rows = await db.prepare(
    `SELECT id, text, due_date AS dueDate, sort_order AS sortOrder, source_daily_task_id AS sourceDailyTaskId, COALESCE(manual_sort, 0) AS manualSort, created_at AS createdAt
     FROM todos
     WHERE completed_at IS NULL AND due_date = ?
     ORDER BY sort_order ASC, created_at ASC`
  ).bind(dueDate).all();
  return (rows.results || []).map((row) => ({
    ...row,
    sortOrder: Number(row.sortOrder) || 0,
    manualSort: Number(row.manualSort) || 0,
  }));
}

async function saveDayRows(db, rows) {
  if (!rows.length) return;
  await db.batch(rows.map((row, index) => (
    db.prepare(
      `UPDATE todos
       SET sort_order = ?, manual_sort = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(index * 1000, Number(row.manualSort) || 0, row.id)
  )));
}

async function loadDailyTaskMap(db, schema = null) {
  const resolvedSchema = schema || await ensureSchema(db);
  const rows = await db.prepare(
    `SELECT CAST(id AS TEXT) AS id, sort_order AS sortOrder, COALESCE(${resolvedSchema.dailyTasksPlacementColumn}, 'top') AS placement, created_at AS createdAt
     FROM daily_tasks
     WHERE active = 1
     ORDER BY sort_order ASC, created_at ASC`
  ).all();
  return new Map((rows.results || []).map((row) => [
    row.id,
    {
      sortOrder: Number(row.sortOrder) || 0,
      placement: normalizePlacement(row.placement),
      createdAt: row.createdAt,
    },
  ]));
}

async function normalizeDailyTaskTexts(db, schema = null) {
  const resolvedSchema = schema || await ensureSchema(db);
  const tasks = await db.prepare(
    `SELECT id AS rawId, CAST(id AS TEXT) AS id, ${resolvedSchema.dailyTasksTextColumn} AS text
     FROM daily_tasks
     WHERE active = 1`
  ).all();

  const taskUpdates = [];
  for (const task of tasks.results || []) {
    const nextText = normalizeDailyText(task.text);
    if (nextText === cleanText(task.text)) continue;
    taskUpdates.push(
      db.prepare(
        `UPDATE daily_tasks
         SET ${resolvedSchema.dailyTasksTextColumn} = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(nextText, task.rawId)
    );
  }
  if (taskUpdates.length) await db.batch(taskUpdates);

  const todos = await db.prepare(
    `SELECT t.id, t.text, t.due_date AS dueDate, dti.${resolvedSchema.dailyInstancesDateColumn} AS generatedDate
     FROM todos t
     LEFT JOIN daily_task_instances dti ON dti.${resolvedSchema.dailyInstancesTodoColumn} = t.id
     WHERE t.source_daily_task_id IS NOT NULL AND t.completed_at IS NULL`
  ).all();

  const todoUpdates = [];
  for (const todo of todos.results || []) {
    const nextText = normalizeDailyText(todo.text);
    const nextDueDate = todo.dueDate === SHOPPING_DUE_DATE && isDateString(todo.generatedDate)
      ? todo.generatedDate
      : todo.dueDate;
    if (nextText === cleanText(todo.text) && nextDueDate === todo.dueDate) continue;
    todoUpdates.push(
      db.prepare(
        `UPDATE todos
         SET text = ?, due_date = ?, manual_sort = 0, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(nextText, nextDueDate, todo.id)
    );
  }
  if (todoUpdates.length) await db.batch(todoUpdates);
}

async function applyShoppingRules(db, schema = null) {
  const rows = await db.prepare(
    `SELECT id, text, due_date AS dueDate
     FROM todos
     WHERE completed_at IS NULL AND due_date != ? AND source_daily_task_id IS NULL
     ORDER BY due_date ASC, sort_order ASC, created_at ASC`
  ).bind(SHOPPING_DUE_DATE).all();

  for (const row of rows.results || []) {
    if (!isShoppingText(row.text)) continue;
    await db.prepare(
      `UPDATE todos
       SET due_date = ?, manual_sort = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(SHOPPING_DUE_DATE, row.id).run();
    await placeTodoByDefault(db, SHOPPING_DUE_DATE, row.id, schema, null, { isNew: true });
  }
}

async function applyOrderingRules(db, today, schema = null) {
  const rows = await db.prepare(
    `SELECT DISTINCT due_date AS dueDate
     FROM todos
     WHERE completed_at IS NULL AND due_date != ? AND due_date >= ?
     ORDER BY due_date ASC`
  ).bind(SHOPPING_DUE_DATE, today).all();
  const dailyTaskMap = await loadDailyTaskMap(db, schema);

  for (const row of rows.results || []) {
    const dayRows = await loadDayRows(db, row.dueDate);
    const reordered = canonicalizeRows(dayRows, dailyTaskMap);
    if (!isSameRowOrder(dayRows, reordered)) await saveDayRows(db, reordered);
  }
}

function canonicalizeRows(rows, dailyTaskMap) {
  return flattenPartitions(partitionRows(rows, dailyTaskMap));
}

function partitionRows(rows, dailyTaskMap) {
  const topDaily = [];
  const bottomDaily = [];
  const prefixGroups = new Map();
  const prefixOrder = [];
  const regular = [];

  for (const row of rows) {
    const placement = getAutoPlacement(row, dailyTaskMap);
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

function moveNonDailyRowToEdge(rows, id, edge, dailyTaskMap) {
  const row = rows.find((item) => item.id === id);
  if (!row || getAutoPlacement(row, dailyTaskMap)) return rows;
  return extractPrefix(row.text)
    ? movePrefixRowToEdge(rows, id, edge, dailyTaskMap)
    : moveRegularRowToEdge(rows, id, edge, dailyTaskMap);
}

function movePrefixRowToEdge(rows, id, edge, dailyTaskMap) {
  const parts = partitionRows(rows, dailyTaskMap);
  const located = locatePrefixRow(parts, id);
  if (!located) return rows;

  const group = parts.prefixGroups[located.groupIndex];
  const [row] = group.rows.splice(located.rowIndex, 1);
  if (edge === "top") {
    if (located.rowIndex > 0) {
      group.rows.unshift(row);
    } else {
      group.rows.unshift(row);
      if (located.groupIndex > 0) {
        const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
        parts.prefixGroups.splice(located.groupIndex - 1, 0, movedGroup);
      }
    }
  } else if (located.rowIndex < group.rows.length) {
    group.rows.push(row);
  } else {
    group.rows.push(row);
    if (located.groupIndex < parts.prefixGroups.length - 1) {
      const [movedGroup] = parts.prefixGroups.splice(located.groupIndex, 1);
      parts.prefixGroups.splice(located.groupIndex + 1, 0, movedGroup);
    }
  }
  return flattenPartitions(parts);
}

function moveRegularRowToEdge(rows, id, edge, dailyTaskMap) {
  const parts = partitionRows(rows, dailyTaskMap);
  const index = parts.regular.findIndex((row) => row.id === id);
  if (index < 0) return rows;
  if ((edge === "top" && index === 0) || (edge === "bottom" && index === parts.regular.length - 1)) return rows;

  const [row] = parts.regular.splice(index, 1);
  if (edge === "bottom") {
    parts.regular.push(row);
  } else {
    parts.regular.unshift(row);
  }
  return flattenPartitions(parts);
}

function moveRowByStep(rows, id, direction, dailyTaskMap) {
  const parts = partitionRows(rows, dailyTaskMap);
  const dailyMoved = moveDailyRowByStep(parts.topDaily, id, direction) || moveDailyRowByStep(parts.bottomDaily, id, direction);
  if (dailyMoved) return flattenPartitions(parts);

  const prefixMoved = movePrefixRowByStep(parts, id, direction);
  if (prefixMoved) return flattenPartitions(parts);

  const regularIndex = parts.regular.findIndex((row) => row.id === id);
  if (regularIndex < 0) return rows;
  const targetIndex = direction === "up" ? regularIndex - 1 : regularIndex + 1;
  if (targetIndex < 0 || targetIndex >= parts.regular.length) return rows;
  const [row] = parts.regular.splice(regularIndex, 1);
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

function locatePrefixRow(parts, id) {
  for (let groupIndex = 0; groupIndex < parts.prefixGroups.length; groupIndex += 1) {
    const rowIndex = parts.prefixGroups[groupIndex].rows.findIndex((row) => row.id === id);
    if (rowIndex >= 0) return { groupIndex, rowIndex };
  }
  return null;
}

function isSameRowOrder(left, right) {
  if (left.length !== right.length) return false;
  return left.every((row, index) => row.id === right[index].id);
}

async function placeTodoByDefault(db, dueDate, todoId, schema = null, providedDailyTaskMap = null, options = {}) {
  const rows = await loadDayRows(db, dueDate);
  const targetIndex = rows.findIndex((row) => row.id === todoId);
  if (targetIndex < 0) return;

  const [row] = rows.splice(targetIndex, 1);
  const dailyTaskMap = providedDailyTaskMap || await loadDailyTaskMap(db, schema);
  const placement = getAutoPlacement(row, dailyTaskMap);

  if (dueDate === SHOPPING_DUE_DATE) {
    rows.unshift(row);
    await saveDayRows(db, rows);
    return;
  }

  const parts = partitionRows(rows, dailyTaskMap);
  if (placement === "top") {
    insertDailyRow(parts.topDaily, row, dailyTaskMap);
  } else if (placement === "bottom") {
    insertDailyRow(parts.bottomDaily, row, dailyTaskMap);
  } else {
    const prefix = extractPrefix(row.text);
    if (prefix) {
      let group = parts.prefixGroups.find((item) => item.prefix === prefix);
      if (!group) {
        group = { prefix, rows: [] };
        parts.prefixGroups.push(group);
      }
      group.rows.push(row);
    } else {
      parts.regular.unshift(row);
    }
  }

  await saveDayRows(db, flattenPartitions(parts));
}

async function placeDailyTodoByPlacement(db, dueDate, sourceDailyTaskId, dailyTaskMap) {
  const rows = await loadDayRows(db, dueDate);
  const targetIndex = rows.findIndex((row) => row.sourceDailyTaskId === sourceDailyTaskId);
  if (targetIndex < 0) return;

  const [row] = rows.splice(targetIndex, 1);
  row.manualSort = 0;
  const taskMeta = dailyTaskMap.get(sourceDailyTaskId);
  const placement = taskMeta ? normalizePlacement(taskMeta.placement) : "top";
  const parts = partitionRows(rows, dailyTaskMap);
  insertDailyRow(placement === "bottom" ? parts.bottomDaily : parts.topDaily, row, dailyTaskMap);
  await saveDayRows(db, flattenPartitions(parts));
}

function insertDailyRow(rows, row, dailyTaskMap) {
  const taskMeta = dailyTaskMap.get(row.sourceDailyTaskId);
  const insertIndex = rows.findIndex((current) => {
    const currentMeta = dailyTaskMap.get(current.sourceDailyTaskId);
    return compareDailyTaskMeta(currentMeta, taskMeta) > 0;
  });
  if (insertIndex < 0) {
    rows.push(row);
  } else {
    rows.splice(insertIndex, 0, row);
  }
}

function getAutoPlacement(row, dailyTaskMap) {
  if (!row.sourceDailyTaskId) return null;
  const taskMeta = dailyTaskMap.get(row.sourceDailyTaskId);
  return taskMeta ? normalizePlacement(taskMeta.placement) : null;
}

function compareDailyTaskMeta(left, right) {
  const leftOrder = Number(left?.sortOrder) || 0;
  const rightOrder = Number(right?.sortOrder) || 0;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return String(left?.createdAt || "").localeCompare(String(right?.createdAt || ""));
}

function normalizeDailyTaskId(schema, id) {
  if (schema.dailyTasksIdMode === "integer") {
    const numericId = Number(id);
    if (Number.isFinite(numericId)) return numericId;
  }
  return id;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

function cleanCounterName(value) {
  return cleanText(value).slice(0, 80);
}

function normalizeCounterColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : "#256d85";
}

function normalizeRecordedAt(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function normalizeDailyText(value) {
  const text = cleanText(value);
  return text.startsWith(DAILY_TASK_PREFIX) ? text : DAILY_TASK_PREFIX + text;
}

function isShoppingText(value) {
  return cleanText(value).startsWith("买");
}

function extractPrefix(value) {
  const match = cleanText(value).match(/^([^:：]{1,48})[:：]/);
  if (!match) return "";
  return match[1].trim().toLocaleLowerCase();
}

function normalizePlacement(value) {
  return value === "bottom" ? "bottom" : "top";
}

function normalizedDate(value) {
  if (isDateString(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function normalizedDueDate(value) {
  if (value === SHOPPING_DUE_DATE) return SHOPPING_DUE_DATE;
  return normalizedDate(value);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeStartDate(value) {
  return isDateString(value) ? value : DAILY_COUNTER_START_DATE;
}

function maxDate(left, right) {
  return left > right ? left : right;
}

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000);
}

function dailyCheckinDateForTodo(todo) {
  if (isDateString(todo?.instanceDate)) return todo.instanceDate;
  if (isDateString(todo?.dueDate) && todo.dueDate !== SHOPPING_DUE_DATE) return todo.dueDate;
  return "";
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function login(request, env) {
  const body = await readJson(request);
  const password = String(body.password || "");
  const hashConfig = typeof env.PASSWORD_HASH === "string" ? env.PASSWORD_HASH.trim() : "";
  const secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET.trim() : "";
  if (!hashConfig || !secret) {
    return json({ error: "auth_not_configured" }, 503);
  }
  if (!isValidHashConfig(hashConfig)) {
    return json({ error: "invalid_auth_config" }, 503);
  }

  await ensureBaseTables(env.DB);
  const ip = clientIp(request);
  const lock = await checkLoginLock(env.DB, ip);
  if (lock.locked) {
    return json({ error: "too_many_attempts", retryAfter: lock.retryAfter }, 429);
  }

  const ok = await verifyPassword(password, hashConfig);
  if (!ok) {
    await recordFailedLogin(env.DB, ip);
    return json({ error: "wrong_password" }, 401);
  }

  await clearLoginFailures(env.DB, ip);
  const exp = Date.now() + SESSION_TTL_MS;
  const token = await signSessionToken({ v: 1, exp, n: randomHex(8) }, secret);
  return json({ token, expiresAt: new Date(exp).toISOString() });
}

async function requireSession(request, env) {
  const secret = typeof env.SESSION_SECRET === "string" ? env.SESSION_SECRET.trim() : "";
  if (!secret) {
    return { ok: false, response: json({ error: "auth_not_configured" }, 503) };
  }
  const header = request.headers.get("X-Todo-Session") || "";
  const valid = await verifySessionToken(header, secret);
  if (!valid) {
    return { ok: false, response: json({ error: "unauthorized" }, 401) };
  }
  return { ok: true };
}

async function signSessionToken(payload, secret) {
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(new TextEncoder().encode(payloadJson));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)));
  return `${payloadB64}.${base64urlEncode(signature)}`;
}

async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const signatureB64 = token.slice(dot + 1);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return false;
  }
  if (!payload || payload.v !== 1 || typeof payload.exp !== "number" || payload.exp <= Date.now()) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)));
  let provided;
  try {
    provided = base64urlDecode(signatureB64);
  } catch {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

async function verifyPassword(password, hashConfig) {
  const parts = hashConfig.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  let salt;
  let expected;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000 || salt.length === 0 || expected.length === 0) {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    expected.length * 8
  ));
  return timingSafeEqual(bits, expected);
}

function isValidHashConfig(hashConfig) {
  const parts = hashConfig.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10000000) return false;
  let salt;
  let expected;
  try {
    salt = base64ToBytes(parts[2]);
    expected = base64ToBytes(parts[3]);
  } catch {
    return false;
  }
  return salt.length > 0 && expected.length > 0;
}

async function checkLoginLock(db, ip) {
  await db.prepare(
    `INSERT OR IGNORE INTO login_attempts (ip, failures, locked_until, updated_at) VALUES (?, 0, NULL, CURRENT_TIMESTAMP)`
  ).bind(ip).run();
  const row = await db.prepare(
    `SELECT failures, locked_until FROM login_attempts WHERE ip = ?`
  ).bind(ip).first();
  const lockedUntil = row && row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false };
}

async function recordFailedLogin(db, ip) {
  const row = await db.prepare(`SELECT failures FROM login_attempts WHERE ip = ?`).bind(ip).first();
  const failures = Number(row?.failures || 0) + 1;
  if (failures >= AUTH_MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + AUTH_LOCK_MS).toISOString();
    await db.prepare(
      `UPDATE login_attempts SET failures = ?, locked_until = ?, updated_at = CURRENT_TIMESTAMP WHERE ip = ?`
    ).bind(failures, lockedUntil, ip).run();
  } else {
    await db.prepare(
      `UPDATE login_attempts SET failures = ?, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE ip = ?`
    ).bind(failures, ip).run();
  }
}

async function clearLoginFailures(db, ip) {
  await db.prepare(
    `UPDATE login_attempts SET failures = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE ip = ?`
  ).bind(ip).run();
}

function clientIp(request) {
  const direct = request.headers.get("CF-Connecting-IP");
  if (direct) return direct;
  const forwarded = request.headers.get("X-Forwarded-For") || "";
  const first = forwarded.split(",")[0].trim();
  return first || "unknown";
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
