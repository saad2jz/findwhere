import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest();
export function createAccess({
  password = '',
  required = false,
  secure = false,
  now = Date.now,
} = {}) {
  const configured = !required || (password.length >= 16 && password.length <= 200);
  const cookieName = secure ? '__Host-findwhere_session' : 'findwhere_session';
  const sessions = new Map();
  const failures = new Map();
  let globalFailures = { start: now(), count: 0 };
  const maxAge = 12 * 60 * 60;
  function sessionKey(req) {
    const cookie = (req.get('cookie') || '')
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith(`${cookieName}=`));
    return cookie ? digest(cookie.slice(cookieName.length + 1)).toString('hex') : null;
  }
  function authorized(req) {
    if (!configured) return false;
    if (!required) return true;
    const key = sessionKey(req);
    if (!key) return false;
    const expires = sessions.get(key);
    if (!expires || expires <= now()) {
      sessions.delete(key);
      return false;
    }
    return true;
  }
  function cookie(value, age) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
  }
  function login(req, res) {
    if (!configured)
      return res
        .status(503)
        .json({
          error:
            'AI access is not configured. The operator must set a password of 16–200 characters.',
        });
    if (!required) return res.json({ authenticated: true });
    const time = now();
    for (const [key, value] of failures)
      if (time - value.start >= 15 * 60_000) failures.delete(key);
    if (time - globalFailures.start >= 60_000) globalFailures = { start: time, count: 0 };
    const key = req.ip || 'local';
    const bucket = failures.get(key);
    if (globalFailures.count >= 20 || bucket?.count >= 5 || (!bucket && failures.size >= 1000)) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' });
    }
    const supplied = req.body?.password;
    if (
      typeof supplied !== 'string' ||
      supplied.length > 200 ||
      !timingSafeEqual(digest(supplied), digest(password))
    ) {
      failures.set(key, { start: bucket?.start ?? time, count: (bucket?.count || 0) + 1 });
      globalFailures.count++;
      return res.status(401).json({ error: 'Incorrect AI access password.' });
    }
    failures.delete(key);
    for (const [key, expires] of sessions) if (expires <= time) sessions.delete(key);
    if (sessions.size >= 50) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('base64url');
    sessions.set(digest(token).toString('hex'), time + maxAge * 1000);
    res.set('Set-Cookie', cookie(token, maxAge));
    return res.json({ authenticated: true });
  }
  function logout(req, res) {
    sessions.delete(sessionKey(req));
    res.set('Set-Cookie', cookie('', 0));
    return res.json({ authenticated: false });
  }
  return { configured, required, authorized, login, logout };
}

export function createDailyQuota({ limit = 10, file = '', now = Date.now } = {}) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000)
    throw new Error('AI_DAILY_LIMIT must be an integer between 0 and 1000.');
  let state;
  let queue = Promise.resolve();
  const day = () => new Date(now()).toISOString().slice(0, 10);
  async function load() {
    if (state) return;
    state = { day: day(), count: 0 };
    if (!file) return;
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data.day) || !Number.isInteger(data.count) || data.count < 0)
        throw new Error('Invalid usage state');
      state = data;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        state = undefined;
        throw new Error('AI usage storage is unavailable. Analysis is paused.');
      }
    }
  }
  function serialized(run) {
    const next = queue.then(run);
    queue = next.catch(() => {});
    return next;
  }
  async function snapshot() {
    await load();
    if (state.day !== day()) state = { day: day(), count: 0 };
    return {
      dailyLimit: limit,
      dailyUsed: state.count,
      dailyRemaining: Math.max(0, limit - state.count),
      resetsAt: new Date(Date.parse(`${day()}T00:00:00Z`) + 86400000).toISOString(),
      quotaScope: file ? 'server-file' : 'server-process',
    };
  }
  return {
    status: () => serialized(snapshot),
    reserve: () =>
      serialized(async () => {
        await snapshot();
        if (state.count >= limit) return false;
        const next = { ...state, count: state.count + 1 };
        if (file) {
          try {
            await mkdir(path.dirname(file), { recursive: true });
            await writeFile(file + '.tmp', JSON.stringify(next), { mode: 0o600 });
            await rename(file + '.tmp', file);
          } catch {
            throw new Error('AI usage storage is unavailable. Analysis is paused.');
          }
        }
        state = next;
        return true;
      }),
  };
}
