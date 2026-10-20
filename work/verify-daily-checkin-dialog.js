const fs = require('fs');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

// Isolated API fixture: this test never reads or writes the live D1 database.
const today = '2026-10-20';
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright', 'daily-checkin-dialog');
const requests = [];
let tasks;
let rejectNextCheckin = false;
const initialTasks = () => [
  { id: 'task-b', text: '（每日任务）护肤', sortOrder: 1000, startDate: '2026-10-18', checkins: ['2026-10-18', '2026-10-19'] },
  { id: 'task-a', text: '（每日任务）淘宝薅羊毛', sortOrder: 0, startDate: '2026-07-01', checkins: ['2026-09-30', ...Array.from({ length: 19 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)] },
];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/index.html' || url.pathname === '/todo.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, 'deploy', url.pathname.slice(1))));
    return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/api/state') {
    res.end(JSON.stringify({ todos: [], dailyTasks: tasks, completedCount: 0, counterItems: [] }));
  } else if (url.pathname === '/api/counters') {
    res.end(JSON.stringify({ items: [], records: [] }));
  } else if (url.pathname === '/api/daily-tasks/checkin' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body);
    requests.push(data);
    if (rejectNextCheckin) {
      rejectNextCheckin = false;
      res.writeHead(500); res.end(JSON.stringify({ error: 'fixture_save_failed' })); return;
    }
    const task = tasks.find((task) => task.id === data.id);
    assert.ok(task, 'request routes to the matching task');
    assert.ok(data.date >= (task.startDate > '2026-10-01' ? task.startDate : '2026-10-01') && data.date <= today, 'check-in stays within the valid month/task range');
    const dates = new Set(task.checkins);
    if (data.checked) dates.add(data.date); else dates.delete(data.date);
    task.checkins = [...dates].sort();
    res.end(JSON.stringify({ ok: true }));
  } else { res.writeHead(404); res.end(JSON.stringify({ error: 'not_found' })); }
});
const day = (page, id, date = today) => page.locator(`.checkin-day[data-task-id="${id}"][data-date="${date}"]`);
async function assertFits(page) {
  const dimensions = await page.evaluate(() => {
    const modal = document.querySelector('.checkin-modal').getBoundingClientRect();
    const body = document.querySelector('.checkin-body');
    const cards = [...document.querySelectorAll('.checkin-task')];
    return {
      left: modal.left, right: modal.right, top: modal.top, bottom: modal.bottom,
      width: innerWidth, height: innerHeight,
      bodyWidth: body.clientWidth, scrollWidth: body.scrollWidth,
      overflowing: cards.filter((card) => card.scrollWidth > card.clientWidth).length,
      minTarget: Math.min(...[...document.querySelectorAll('.checkin-day')].map((button) => button.getBoundingClientRect().height)),
    };
  });
  assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.width && dimensions.top >= 0 && dimensions.bottom <= dimensions.height, 'dialog fits viewport');
  assert.ok(dimensions.scrollWidth <= dimensions.bodyWidth + 1 && !dimensions.overflowing, 'no horizontal overflow');
  assert.ok(dimensions.minTarget >= 44, 'calendar touch target height');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}) });
  try {
    for (const file of ['todo.html', 'index.html']) {
      tasks = initialTasks();
      requests.length = 0;
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Shanghai' });
      await context.addInitScript(() => localStorage.setItem('todo-session-token', 'fixture-session'));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-10-20T12:00:00+08:00'));
      await page.goto(`${base}/${file}`);
      await page.waitForFunction(() => !document.body.classList.contains('read-only'));
      await page.locator('.daily-count-button[data-task-id="task-b"]').click();
      assert.equal(await page.locator('#checkinTitle').innerText(), '每日任务补打卡');
      assert.deepEqual(await page.locator('.checkin-task-title').allTextContents(), ['淘宝薅羊毛', '护肤']);
      assert.equal(await page.locator('.checkin-task[data-task-id="task-a"] .checkin-day').count(), 20);
      assert.equal(await page.locator('.checkin-task[data-task-id="task-b"] .checkin-day').count(), 3);
      assert.equal(await page.locator('.checkin-day[data-date="2026-09-30"]').count(), 0);
      assert.equal(await page.locator('.checkin-day[data-date="2026-10-21"]').count(), 0);
      assert.equal(await page.locator('.checkin-task[data-task-id="task-a"] .checkin-task-stats').innerText(), '本月打卡：19/20 95.00%');
      assert.equal(await page.locator('.checkin-task[data-task-id="task-b"] .checkin-task-stats').innerText(), '本月打卡：2/3 66.67%');
      await page.waitForFunction(() => document.activeElement?.dataset.taskId === 'task-b');
      await assertFits(page);
      if (file === 'todo.html') await page.screenshot({ path: path.join(output, 'desktop.png') });

      // Complete two different tasks without closing the dialog; persist and rerender.
      await day(page, 'task-a').click();
      await day(page, 'task-b').click();
      assert.equal(await day(page, 'task-a').getAttribute('aria-pressed'), 'true');
      assert.equal(await day(page, 'task-b').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#checkinSummary').innerText(), /今日完成 2\/2/);
      await page.evaluate(() => flushPendingMutations());
      assert.deepEqual(requests.map(({ id, date, checked }) => ({ id, date, checked })), [
        { id: 'task-a', date: today, checked: true }, { id: 'task-b', date: today, checked: true },
      ]);
      assert.equal(await page.locator('#checkinBackdrop.open').count(), 1);
      assert.equal(await day(page, 'task-b').evaluate((button) => document.activeElement === button), true, 'focus survives server refresh');
      assert.equal(await page.locator('.daily-count-button[data-task-id="task-a"]').innerText(), '20/20   100.00%');
      // Calendar callbacks must use refreshed task objects, not stale ones.
      await day(page, 'task-a', '2026-10-19').click();
      await page.evaluate(() => flushPendingMutations());
      assert.equal(await day(page, 'task-a', '2026-10-19').getAttribute('aria-pressed'), 'false');
      assert.equal(await day(page, 'task-b').getAttribute('aria-pressed'), 'true');

      // Failed writes revert to server truth while preserving the open dialog.
      rejectNextCheckin = true;
      await day(page, 'task-b', '2026-10-18').click();
      await page.evaluate(() => flushPendingMutations());
      assert.equal(await day(page, 'task-b', '2026-10-18').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#checkinBackdrop.open').count(), 1);

      // Tab stays in the dialog; Escape returns to the original task's trigger.
      await page.locator('#closeCheckin').focus();
      await page.keyboard.press('Shift+Tab');
      assert.equal(await day(page, 'task-b').evaluate((button) => document.activeElement === button), true);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#closeCheckin').evaluate((button) => document.activeElement === button), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#checkinBackdrop.open').count(), 0);
      assert.equal(await page.locator('.daily-count-button[data-task-id="task-b"]').evaluate((button) => document.activeElement === button), true);
      await page.locator('.daily-count-button[data-task-id="task-a"]').click();
      assert.equal(await page.locator('.checkin-task').count(), 2, 'any daily task opens the same unified dialog');
      await page.locator('#closeCheckin').click();

      // Many tasks, long/untrusted titles and future starts remain readable on mobile.
      tasks.push({ id: 'future', text: '（每日任务）明天开始', sortOrder: 2000, startDate: '2026-10-21', checkins: [] });
      const untrustedTitle = '<img src=x onerror=alert(1)>这是一个用于验证换行的很长每日任务名称'.repeat(3);
      tasks.push({ id: 'long', text: `（每日任务）${untrustedTitle}`, sortOrder: 3000, startDate: '2026-10-20', checkins: [] });
      for (let i = 0; i < 6; i++) tasks.push({ id: `extra-${i}`, text: `（每日任务）日常习惯 ${i + 1}`, sortOrder: 4000 + i, startDate: '2026-10-01', checkins: [] });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => refresh());
      await page.locator('.daily-count-button[data-task-id="task-a"]').click();
      assert.equal(await page.locator('.checkin-task').count(), 10);
      assert.equal(await page.locator('.checkin-task[data-task-id="future"] .checkin-day').count(), 0);
      assert.equal(await page.locator('.checkin-task[data-task-id="long"] .checkin-task-title').innerText(), untrustedTitle);
      assert.equal(await page.locator('.checkin-task img').count(), 0, 'task names are escaped');
      await assertFits(page);
      if (file === 'todo.html') await page.screenshot({ path: path.join(output, 'mobile.png') });
      await day(page, 'extra-5', '2026-10-01').click();
      const scrollTop = await page.locator('.checkin-body').evaluate((body) => body.scrollTop);
      assert.ok(scrollTop > 0, 'the dialog scrolls for many tasks');
      await page.evaluate(() => flushPendingMutations());
      assert.equal(await day(page, 'extra-5', '2026-10-01').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('.checkin-body').evaluate((body) => body.scrollTop), scrollTop, 'save preserves dialog scroll');
      assert.equal(await day(page, 'extra-5', '2026-10-01').evaluate((button) => document.activeElement === button), true);
      await page.setViewportSize({ width: 360, height: 640 });
      await assertFits(page);

      // A read-only transition prevents further mutations. Empty state is explicit.
      const writeCount = requests.length;
      await page.evaluate(() => { setReadOnly(true); render(); });
      assert.equal(await page.locator('.checkin-day:not(:disabled)').count(), 0);
      await page.evaluate(() => toggleDailyCheckin(state.dailyTasks[0], state.today, true));
      assert.equal(requests.length, writeCount);
      tasks = [];
      await page.evaluate(() => refresh());
      assert.equal(await page.locator('#checkinTasks .daily-empty').innerText(), '暂无每日任务');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#checkinBackdrop.open').count(), 0);
      assert.deepEqual(errors, [], `${file}: no runtime errors`);
      await context.close();
      console.log(`verify: unified daily check-in dialog passed (${file}, multi-task persistence, dates, focus, errors, mobile, scrolling, read-only, empty states)`);
    }
  } finally { await browser.close(); }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
