import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';
import { prisma } from '../../lib/prisma';

/**
 * When a task happens (docs/designs/task-due-and-work-blocks.md).
 *
 *   one-off task ── dueDate is the deadline only; planned time is its work
 *                   blocks, written as a whole list with the task
 *   recurring task ─ its own startMinutes/endMinutes, the slot each day takes
 *
 * Times are minutes from LOCAL midnight, so 09:00 stays 09:00 across a time
 * zone change. These run against a real Postgres and the real Express app.
 */

/** 'YYYY-MM-DD' n days from today, in UTC — matches the dueDate convention. */
function dayOffset(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = () => dayOffset(0);

const NINE_AM = 9 * 60;          // 540
const TEN_THIRTY = 10 * 60 + 30; // 630
const ELEVEN = 11 * 60;

interface Block { date: string; startMinutes: number | null; endMinutes: number | null }

async function createTask(user: TestUser, body: Record<string, unknown>) {
  const res = await authed(user).post('/tasks').send({ title: 'Proposal', ...body });
  expect(res.status).toBe(200);
  return res.body.data as { id: string; blocks: Block[]; startMinutes: number | null; endMinutes: number | null };
}

async function listed(user: TestUser, id: string) {
  const list = await authed(user).get('/tasks');
  return list.body.data.find((t: { id: string }) => t.id === id) as { blocks: Block[] };
}

describe('POST /tasks — work blocks', () => {
  it('stores blocks sorted by day and time and returns them, also from GET /tasks', async () => {
    const user = await createUser();
    const task = await createTask(user, {
      dueDate: dayOffset(4),
      blocks: [
        { date: dayOffset(2) },
        { date: dayOffset(0), startMinutes: NINE_AM, endMinutes: ELEVEN },
      ],
    });

    const expected = [
      { date: dayOffset(0), startMinutes: NINE_AM, endMinutes: ELEVEN },
      { date: dayOffset(2), startMinutes: null, endMinutes: null },
    ];
    expect(task.blocks.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes }))).toEqual(expected);
    const stored = await listed(user, task.id);
    expect(stored.blocks.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes }))).toEqual(expected);
  });

  it('needs no due date, and a plain task has no blocks', async () => {
    const user = await createUser();
    const planned = await createTask(user, { blocks: [{ date: today() }] });
    expect(planned.blocks).toHaveLength(1);

    const plain = await createTask(user, { title: 'Plain' });
    expect(plain.blocks).toEqual([]);
    expect(plain.startMinutes).toBeNull();
  });

  it('refuses times on a one-off task: they live on work blocks', async () => {
    const user = await createUser();
    const res = await authed(user).post('/tasks').send({
      title: 'Old client', dueDate: today(), startMinutes: NINE_AM, endMinutes: TEN_THIRTY,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Times live on work blocks');
  });

  it.each([
    ['an end not after the start', [{ date: '2026-11-02', startMinutes: TEN_THIRTY, endMinutes: NINE_AM }], /after start/i],
    ['a start with no end', [{ date: '2026-11-02', startMinutes: NINE_AM }], /both a start and an end/i],
    ['two any-time blocks on one day', [{ date: '2026-11-02' }, { date: '2026-11-02' }], /one any-time/i],
    ['two blocks starting together', [
      { date: '2026-11-02', startMinutes: NINE_AM, endMinutes: TEN_THIRTY },
      { date: '2026-11-02', startMinutes: NINE_AM, endMinutes: ELEVEN },
    ], /same time/i],
    ['an impossible date', [{ date: '2026-13-45' }], /real YYYY-MM-DD/i],
    ['minutes past the end of the day', [{ date: '2026-11-02', startMinutes: 1400, endMinutes: 1500 }], /.+/],
  ])('rejects %s', async (_label, blocks, message) => {
    const user = await createUser();
    const res = await authed(user).post('/tasks').send({ title: 'Bad', blocks });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects more than 100 blocks', async () => {
    const user = await createUser();
    const blocks = Array.from({ length: 101 }, (_, i) => ({ date: '2026-11-02', startMinutes: i * 10, endMinutes: i * 10 + 5 }));
    const res = await authed(user).post('/tasks').send({ title: 'Too many', blocks });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 100/);
  });

  it('refuses blocks on a recurring task', async () => {
    const user = await createUser();
    const res = await authed(user).post('/tasks').send({
      title: 'Gym', isRecurring: true, recurringDays: [], localDate: today(), blocks: [{ date: today() }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Work blocks are for one-off tasks');
  });
});

describe('PATCH /tasks/:id — work blocks', () => {
  it('replaces the whole list, and keeps old blocks the app sends back', async () => {
    const user = await createUser();
    const old = { date: dayOffset(-60), startMinutes: NINE_AM, endMinutes: ELEVEN };
    const task = await createTask(user, { blocks: [old, { date: dayOffset(1) }] });

    // The app holds every block (GET /tasks returns them all) and sends the
    // full list back with one change: nothing it did not mean to drop goes.
    const res = await authed(user).patch(`/tasks/${task.id}`).send({
      blocks: [old, { date: dayOffset(3), startMinutes: TEN_THIRTY, endMinutes: ELEVEN }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.blocks.map((b: Block) => b.date)).toEqual([dayOffset(-60), dayOffset(3)]);
    expect(await prisma.workBlock.count({ where: { taskId: task.id } })).toBe(2);
  });

  it('leaves blocks alone when the patch has no blocks key, and still returns them', async () => {
    const user = await createUser();
    const task = await createTask(user, { blocks: [{ date: today() }] });

    const res = await authed(user).patch(`/tasks/${task.id}`).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
    // The app merges this response over its copy: blocks must be in it, or a
    // later form save would send an empty list and delete them.
    expect(res.body.data.blocks).toHaveLength(1);
    expect(await prisma.workBlock.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('clears all blocks with an empty list', async () => {
    const user = await createUser();
    const task = await createTask(user, { blocks: [{ date: today() }] });
    const res = await authed(user).patch(`/tasks/${task.id}`).send({ blocks: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.blocks).toEqual([]);
  });

  it('refuses times on a one-off task but allows clearing them', async () => {
    const user = await createUser();
    const task = await createTask(user, {});
    const set = await authed(user).patch(`/tasks/${task.id}`).send({ startMinutes: NINE_AM, endMinutes: ELEVEN });
    expect(set.status).toBe(400);
    expect(set.body.error).toBe('Times live on work blocks');
    const clear = await authed(user).patch(`/tasks/${task.id}`).send({ startMinutes: null, endMinutes: null });
    expect(clear.status).toBe(200);
  });

  it('rolls back the block change when the task write fails', async () => {
    const user = await createUser();
    const task = await createTask(user, { blocks: [{ date: today() }] });

    // `order` past the int4 range fails the task update AFTER the blocks were
    // replaced inside the transaction; nothing may be left half-written.
    const res = await authed(user).patch(`/tasks/${task.id}`).send({
      order: 2 ** 40,
      blocks: [{ date: dayOffset(5) }],
    });
    expect(res.status).toBe(500);
    const blocks = await prisma.workBlock.findMany({ where: { taskId: task.id } });
    expect(blocks.map((b) => b.date)).toEqual([today()]);
  });

  it("will not let one user change another person's blocks", async () => {
    const owner = await createUser();
    const other = await createUser();
    const task = await createTask(owner, { blocks: [{ date: today() }] });

    const res = await authed(other).patch(`/tasks/${task.id}`).send({ blocks: [] });
    expect(res.status).toBe(404);
    expect(await prisma.workBlock.count({ where: { taskId: task.id } })).toBe(1);
  });
});

describe('converting between one-off and recurring', () => {
  it('becoming a habit takes the earliest timed block and drops every block', async () => {
    const user = await createUser();
    const task = await createTask(user, {
      blocks: [
        { date: dayOffset(1) },
        { date: dayOffset(2), startMinutes: TEN_THIRTY, endMinutes: ELEVEN },
        { date: dayOffset(3), startMinutes: NINE_AM, endMinutes: TEN_THIRTY },
      ],
    });

    const res = await authed(user).patch(`/tasks/${task.id}`).send({ isRecurring: true, recurringDays: [], localDate: today() });
    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBe(TEN_THIRTY);
    expect(res.body.data.endMinutes).toBe(ELEVEN);
    expect(await prisma.workBlock.count({ where: { taskId: task.id } })).toBe(0);
  });

  it('a time sent with the conversion wins over the blocks', async () => {
    const user = await createUser();
    const task = await createTask(user, { blocks: [{ date: today(), startMinutes: NINE_AM, endMinutes: ELEVEN }] });
    const res = await authed(user).patch(`/tasks/${task.id}`).send({
      isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 7 * 60, endMinutes: 8 * 60,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBe(7 * 60);
  });

  it('becoming one-off clears the habit time and takes the blocks sent', async () => {
    const user = await createUser();
    const habit = await createTask(user, {
      title: 'Gym', isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 7 * 60, endMinutes: 8 * 60,
    });

    const res = await authed(user).patch(`/tasks/${habit.id}`).send({
      isRecurring: false,
      blocks: [{ date: today(), startMinutes: 7 * 60, endMinutes: 8 * 60 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.startMinutes).toBeNull();
    expect(res.body.data.blocks).toHaveLength(1);
  });

  it('resending an unchanged isRecurring converts nothing', async () => {
    const user = await createUser();
    const task = await createTask(user, { blocks: [{ date: today() }] });
    const res = await authed(user).patch(`/tasks/${task.id}`).send({ isRecurring: false, recurringDays: [], title: 'Same kind' });
    expect(res.status).toBe(200);
    expect(res.body.data.blocks).toHaveLength(1);
  });
});

describe('scheduled times on recurring tasks', () => {
  it("gives today's row the habit's time slot", async () => {
    // "Gym at 07:00" has to show at 07:00 — the time is part of the habit.
    const user = await createUser();
    await createTask(user, {
      title: 'Gym', isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 7 * 60, endMinutes: 8 * 60,
    });

    const list = await authed(user).get('/tasks');
    const row = list.body.data.find((t: { title: string }) => t.title === 'Gym');
    expect(row.startMinutes).toBe(7 * 60);
    expect(row.endMinutes).toBe(8 * 60);
  });

  it('lets a habit hold a time slot without a due date of its own', async () => {
    const user = await createUser();
    const habit = await createTask(user, {
      title: 'Stretch', isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 6 * 60, endMinutes: 6 * 60 + 20,
    });
    expect(habit.startMinutes).toBe(6 * 60);
  });

  it('refuses half a time on a habit, also when a patch clears one end', async () => {
    const user = await createUser();
    const bad = await authed(user).post('/tasks').send({
      title: 'Half', isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 6 * 60,
    });
    expect(bad.status).toBe(400);

    const habit = await createTask(user, {
      title: 'Whole', isRecurring: true, recurringDays: [], localDate: today(), startMinutes: 6 * 60, endMinutes: 7 * 60,
    });
    const res = await authed(user).patch(`/tasks/${habit.id}`).send({ startMinutes: null });
    expect(res.status).toBe(400);
  });
});

describe('GET /calendar — work blocks and due dates', () => {
  it('draws each block as its task on the block day, and the due day as a deadline', async () => {
    const user = await createUser();
    const task = await createTask(user, {
      title: 'Deep work',
      dueDate: dayOffset(2),
      blocks: [{ date: today(), startMinutes: NINE_AM, endMinutes: TEN_THIRTY }, { date: dayOffset(1) }],
    });

    const res = await authed(user).get(`/calendar?start=${today()}&end=${dayOffset(2)}`);
    expect(res.status).toBe(200);
    const items = res.body.data.items as { type: string; date: string; data: { id: string; startMinutes: number | null; endMinutes: number | null } }[];
    const mine = items.filter((i) => i.data?.id === task.id);

    expect(mine.map((i) => [i.type, i.date, i.data.startMinutes])).toEqual([
      ['work_block', today(), NINE_AM],
      ['work_block', dayOffset(1), null],
      ['task_due', dayOffset(2), null],
    ]);
    expect(items.some((i) => i.type === 'task')).toBe(false);
  });

  it('keeps a done task on its due day, and hides an archived task entirely', async () => {
    const user = await createUser();
    const done = await createTask(user, { title: 'Done', dueDate: today(), blocks: [{ date: today() }] });
    const gone = await createTask(user, { title: 'Gone', dueDate: today(), blocks: [{ date: today() }] });
    await authed(user).patch(`/tasks/${done.id}`).send({ isCompleted: true, completedAt: new Date().toISOString() });
    await authed(user).delete(`/tasks/${gone.id}`);

    const res = await authed(user).get(`/calendar?start=${today()}&end=${today()}`);
    const items = res.body.data.items as { type: string; data: { id: string; isCompleted?: boolean } }[];
    expect(items.filter((i) => i.data?.id === done.id).map((i) => i.type).sort()).toEqual(['task_due', 'work_block']);
    expect(items.find((i) => i.type === 'task_due' && i.data.id === done.id)?.data.isCompleted).toBe(true);
    expect(items.some((i) => i.data?.id === gone.id)).toBe(false);
  });
});
