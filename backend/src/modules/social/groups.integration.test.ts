import { describe, it, expect } from 'vitest';
import { createUser, authed, type TestUser } from '../../test/factories';

/**
 * Focus groups: detail + member management.
 *
 * Ownership model under test — the creator manages membership, everyone else
 * may only join a public group or leave one:
 *
 *   creator ──┬─ POST   /groups/:id/members            add anyone
 *             ├─ DELETE /groups/:id/members/:userId    remove anyone but self
 *             └─ POST   /groups/:id/leave              REFUSED (would strand it)
 *
 *   member  ──┬─ GET    /groups/:id                    read detail
 *             ├─ POST   /groups/:id/members            403
 *             └─ POST   /groups/:id/leave              allowed
 *
 *   outsider ─── GET    /groups/:id                    ok if public, 404 if private
 */

async function createGroup(user: TestUser, over: Record<string, unknown> = {}) {
  const res = await authed(user).post('/social/groups').send({
    name: 'Study crew', emoji: '📚', color: 'purple', isPrivate: false, ...over,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('POST /social/groups — description', () => {
  it('round-trips a description', async () => {
    const user = await createUser();
    const group = await createGroup(user, { description: 'Mornings, 6am, no excuses.' });
    expect(group.description).toBe('Mornings, 6am, no excuses.');

    const detail = await authed(user).get(`/social/groups/${group.id}`);
    expect(detail.body.data.description).toBe('Mornings, 6am, no excuses.');
  });

  it('defaults description to null when omitted', async () => {
    const user = await createUser();
    const group = await createGroup(user);
    expect(group.description).toBeNull();
  });

  it('rejects a description over 500 characters', async () => {
    const user = await createUser();
    const res = await authed(user).post('/social/groups').send({
      name: 'Too wordy', emoji: '📚', description: 'x'.repeat(501),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /social/groups/:id', () => {
  it('returns detail with the creator as the only member', async () => {
    const user = await createUser();
    const group = await createGroup(user);

    const res = await authed(user).get(`/social/groups/${group.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Study crew');
    expect(res.body.data.isCreator).toBe(true);
    expect(res.body.data.memberCount).toBe(1);
    expect(res.body.data.members).toHaveLength(1);
    expect(res.body.data.members[0].id).toBe(user.id);
    expect(res.body.data.members[0].isCreator).toBe(true);
    // Every member carries a usable avatar, even when the user never chose one.
    expect(res.body.data.members[0].avatarEmoji).toBeTruthy();
  });

  it('is NOT shadowed by the /all route', async () => {
    // `/social/groups/all` is a literal path registered before `:id`. If the
    // order ever flips, this returns a single group instead of the directory.
    const user = await createUser();
    await createGroup(user);

    const res = await authed(user).get('/social/groups/all');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('lets a non-member read a PUBLIC group', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner);

    const res = await authed(outsider).get(`/social/groups/${group.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isMember).toBe(false);
    expect(res.body.data.isCreator).toBe(false);
  });

  it('hides a PRIVATE group from a non-member as 404, not 403', async () => {
    // 403 would confirm the group exists. Private groups reveal nothing.
    const owner = await createUser();
    const outsider = await createUser();
    const group = await createGroup(owner, { isPrivate: true });

    const res = await authed(outsider).get(`/social/groups/${group.id}`);

    expect(res.status).toBe(404);
  });

  it('404s an unknown group id', async () => {
    const user = await createUser();
    const res = await authed(user).get('/social/groups/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const user = await createUser();
    const group = await createGroup(user);
    const res = await authed({ ...user, accessToken: 'not-a-token' }).get(`/social/groups/${group.id}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /social/groups/:id/members', () => {
  it('lets the creator add someone', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner);

    const res = await authed(owner).post(`/social/groups/${group.id}/members`)
      .send({ userId: invitee.id });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(invitee.id);
    expect(res.body.data.isCreator).toBe(false);

    const detail = await authed(owner).get(`/social/groups/${group.id}`);
    expect(detail.body.data.memberCount).toBe(2);
  });

  it('adds into a PRIVATE group, which is the only way in', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner, { isPrivate: true });

    // The invitee cannot even see it beforehand.
    expect((await authed(invitee).get(`/social/groups/${group.id}`)).status).toBe(404);

    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: invitee.id });

    expect((await authed(invitee).get(`/social/groups/${group.id}`)).status).toBe(200);
  });

  it('is idempotent — adding twice does not duplicate the member', async () => {
    const owner = await createUser();
    const invitee = await createUser();
    const group = await createGroup(owner);

    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: invitee.id });
    const second = await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: invitee.id });

    expect(second.status).toBe(201);
    const detail = await authed(owner).get(`/social/groups/${group.id}`);
    expect(detail.body.data.memberCount).toBe(2);
  });

  it('refuses a plain member with 403', async () => {
    const owner = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner);
    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: member.id });

    const res = await authed(member).post(`/social/groups/${group.id}/members`)
      .send({ userId: stranger.id });

    expect(res.status).toBe(403);
  });

  it('404s an unknown target user', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await authed(owner).post(`/social/groups/${group.id}/members`)
      .send({ userId: '00000000-0000-0000-0000-000000000000' });

    expect(res.status).toBe(404);
  });

  it('rejects a malformed userId', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);
    const res = await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: 'nope' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /social/groups/:id/members/:userId', () => {
  it('lets the creator remove a member', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner);
    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: member.id });

    const res = await authed(owner).delete(`/social/groups/${group.id}/members/${member.id}`);

    expect(res.status).toBe(200);
    const detail = await authed(owner).get(`/social/groups/${group.id}`);
    expect(detail.body.data.memberCount).toBe(1);
  });

  it('refuses to remove the creator', async () => {
    // Nobody could manage the group afterwards.
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await authed(owner).delete(`/social/groups/${group.id}/members/${owner.id}`);

    expect(res.status).toBe(400);
  });

  it('refuses a plain member with 403', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner);
    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: member.id });

    const res = await authed(member).delete(`/social/groups/${group.id}/members/${owner.id}`);

    expect(res.status).toBe(403);
  });

  it('404s removing someone who is not in the group', async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const group = await createGroup(owner);

    const res = await authed(owner).delete(`/social/groups/${group.id}/members/${stranger.id}`);

    expect(res.status).toBe(404);
  });
});

describe('POST /social/groups/:id/leave', () => {
  it('refuses to let the creator leave', async () => {
    const owner = await createUser();
    const group = await createGroup(owner);

    const res = await authed(owner).post(`/social/groups/${group.id}/leave`);

    expect(res.status).toBe(400);
    const detail = await authed(owner).get(`/social/groups/${group.id}`);
    expect(detail.body.data.memberCount).toBe(1);
  });

  it('still lets an ordinary member leave', async () => {
    const owner = await createUser();
    const member = await createUser();
    const group = await createGroup(owner);
    await authed(owner).post(`/social/groups/${group.id}/members`).send({ userId: member.id });

    const res = await authed(member).post(`/social/groups/${group.id}/leave`);

    expect(res.status).toBe(200);
    const detail = await authed(owner).get(`/social/groups/${group.id}`);
    expect(detail.body.data.memberCount).toBe(1);
  });
});
