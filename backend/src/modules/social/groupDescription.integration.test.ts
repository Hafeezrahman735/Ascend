import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';

/**
 * `PATCH /social/groups/:id` — the About text.
 *
 * The permission model is the whole point of this file, because it is wider
 * than anything else on a group: ANY member may write the description, while
 * membership itself is managed by the creator alone. The tests below pin both
 * halves — that a plain member really can write it, and that a non-member of a
 * PUBLIC group still cannot.
 */

async function makeGroup(user: TestUser, isPrivate = false) {
  const res = await authed(user).post('/social/groups').send({
    name: 'Focus Group', emoji: '📚', isPrivate,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function join(user: TestUser, groupId: string) {
  const res = await authed(user).post(`/social/groups/${groupId}/join`).send({});
  expect(res.status).toBe(200);
}

async function readDescription(user: TestUser, groupId: string) {
  const res = await authed(user).get(`/social/groups/${groupId}`);
  expect(res.status).toBe(200);
  return res.body.data.description as string | null;
}

describe('PATCH /social/groups/:id', () => {
  it('lets the creator write the About text', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);

    const res = await authed(creator).patch(`/social/groups/${groupId}`)
      .send({ description: 'We revise chemistry on weekday mornings.' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('We revise chemistry on weekday mornings.');
    expect(await readDescription(creator, groupId)).toBe('We revise chemistry on weekday mornings.');
  });

  it('lets an ordinary member write it too', async () => {
    // The deliberate widening. A member is not allowed to add or remove people,
    // but the description is shared context rather than administration.
    const creator = await createUser();
    const member = await createUser();
    const groupId = await makeGroup(creator);
    await join(member, groupId);

    const res = await authed(member).patch(`/social/groups/${groupId}`)
      .send({ description: 'Written by someone who did not create the group.' });

    expect(res.status).toBe(200);
    expect(await readDescription(creator, groupId))
      .toBe('Written by someone who did not create the group.');
  });

  it('lets one member overwrite another’s text', async () => {
    // A consequence of the permission, asserted so it is a decision on record
    // rather than a surprise. There is no history; an overwrite is final.
    const creator = await createUser();
    const member = await createUser();
    const groupId = await makeGroup(creator);
    await join(member, groupId);

    await authed(creator).patch(`/social/groups/${groupId}`).send({ description: 'First' });
    await authed(member).patch(`/social/groups/${groupId}`).send({ description: 'Second' });

    expect(await readDescription(creator, groupId)).toBe('Second');
  });

  it('refuses a non-member of a PUBLIC group', async () => {
    // The trap this route has to avoid: resolveGroupAccess returns ok for any
    // signed-in user reading a public group, so membership is checked on top.
    const creator = await createUser();
    const stranger = await createUser();
    const groupId = await makeGroup(creator, false);

    const res = await authed(stranger).patch(`/social/groups/${groupId}`)
      .send({ description: 'I am not in this group.' });

    expect(res.status).toBe(403);
    expect(await readDescription(creator, groupId)).toBeNull();
  });

  it('gives a non-member of a PRIVATE group a 404, not a 403', async () => {
    // A private group reveals nothing to outsiders, including that it exists.
    const creator = await createUser();
    const stranger = await createUser();
    const groupId = await makeGroup(creator, true);

    const res = await authed(stranger).patch(`/social/groups/${groupId}`)
      .send({ description: 'Let me in.' });

    expect(res.status).toBe(404);
  });

  it('clears the description when sent empty or whitespace', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);
    await authed(creator).patch(`/social/groups/${groupId}`).send({ description: 'Something' });

    const res = await authed(creator).patch(`/social/groups/${groupId}`).send({ description: '   ' });

    expect(res.status).toBe(200);
    // null, not '', so the client's empty state stays one condition.
    expect(res.body.data.description).toBeNull();
    expect(await readDescription(creator, groupId)).toBeNull();
  });

  it('trims surrounding whitespace rather than storing it', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);

    const res = await authed(creator).patch(`/social/groups/${groupId}`)
      .send({ description: '  Morning revision.  ' });

    expect(res.body.data.description).toBe('Morning revision.');
  });

  it('accepts an explicit null', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);
    await authed(creator).patch(`/social/groups/${groupId}`).send({ description: 'Text' });

    const res = await authed(creator).patch(`/social/groups/${groupId}`).send({ description: null });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBeNull();
  });

  it('rejects a description longer than 500 characters', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);

    const res = await authed(creator).patch(`/social/groups/${groupId}`)
      .send({ description: 'x'.repeat(501) });

    expect(res.status).toBe(400);
  });

  it('rejects a missing description rather than silently clearing it', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);
    await authed(creator).patch(`/social/groups/${groupId}`).send({ description: 'Keep me' });

    const res = await authed(creator).patch(`/social/groups/${groupId}`).send({});

    expect(res.status).toBe(400);
    expect(await readDescription(creator, groupId)).toBe('Keep me');
  });

  it('404s on a group that does not exist', async () => {
    const user = await createUser();
    const res = await authed(user)
      .patch('/social/groups/00000000-0000-0000-0000-000000000000')
      .send({ description: 'Nowhere' });
    expect(res.status).toBe(404);
  });

  it('401s without a token', async () => {
    const creator = await createUser();
    const groupId = await makeGroup(creator);

    const res = await authed({ ...creator, accessToken: 'nope' })
      .patch(`/social/groups/${groupId}`).send({ description: 'Nope' });

    expect(res.status).toBe(401);
  });
});
