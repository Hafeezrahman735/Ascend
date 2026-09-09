import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The email transport's decisions, not its network call.
 *
 * `fetch` is stubbed, so these assert the contract every caller depends on:
 * sendEmail NEVER throws and NEVER 500s a route, whatever the provider does.
 * Both call sites — password reset and content-report alerts — are on paths
 * where the user has already been given a deliberately generic answer, so an
 * exception escaping here would break that promise and, for password reset,
 * leak whether the address existed.
 *
 * The sender parsing matters because EMAIL_FROM is written in header form
 * (`Ascend <you@example.com>`) while Brevo wants name and address as separate
 * JSON fields. Getting that wrong is a 400 from the provider and no mail.
 */
vi.mock('../config', () => ({
  config: {
    BREVO_API_KEY: 'test-key',
    EMAIL_FROM: 'Ascend <sender@example.test>',
  },
}));

const MAIL = {
  to: 'user@example.test',
  subject: 'Subject',
  text: 'body',
  html: '<p>body</p>',
};

let sendEmail: typeof import('./email').sendEmail;
let isEmailConfigured: typeof import('./email').isEmailConfigured;

beforeEach(async () => {
  vi.resetModules();
  ({ sendEmail, isEmailConfigured } = await import('./email'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isEmailConfigured', () => {
  it('is true when the key and sender are both present', () => {
    expect(isEmailConfigured()).toBe(true);
  });
});

describe('sendEmail', () => {
  it('splits EMAIL_FROM into the name and address Brevo expects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail(MAIL);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('test-key');

    const body = JSON.parse(init.body);
    expect(body.sender).toEqual({ name: 'Ascend', email: 'sender@example.test' });
    expect(body.to).toEqual([{ email: 'user@example.test' }]);
    expect(body.subject).toBe('Subject');
    expect(body.textContent).toBe('body');
    expect(body.htmlContent).toBe('<p>body</p>');
  });

  it('returns true on a successful send', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 201 }));
    await expect(sendEmail(MAIL)).resolves.toBe(true);
  });

  it('resolves false rather than throwing when the provider rejects', async () => {
    // An unverified sender, a bad key, the daily cap. All operator errors, none
    // of which may reach the caller as an exception.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"message":"Sender not valid"}'),
      }),
    );
    await expect(sendEmail(MAIL)).resolves.toBe(false);
  });

  it('resolves false rather than throwing when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));
    await expect(sendEmail(MAIL)).resolves.toBe(false);
  });

  it('resolves false rather than hanging a request forever', async () => {
    // The abort path. Every caller is fire-and-forget, but a promise that never
    // settles still pins whatever awaited it.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }),
    );
    await expect(sendEmail(MAIL)).resolves.toBe(false);
  });
});

describe('sendEmail when unconfigured', () => {
  it('drops the mail and resolves false without calling the provider', async () => {
    // The password-reset integration tests depend on exactly this: unconfigured
    // is a supported state, not a hole, so the route still answers normally.
    vi.resetModules();
    vi.doMock('../config', () => ({ config: { BREVO_API_KEY: undefined, EMAIL_FROM: undefined } }));
    const mod = await import('./email');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(mod.isEmailConfigured()).toBe(false);
    await expect(mod.sendEmail(MAIL)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
