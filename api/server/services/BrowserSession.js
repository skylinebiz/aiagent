const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const profiles = new Map();
const sessions = new Map();
const queues = new Map();
const sessionStarts = new Map();

function keyFor(userId) {
  // This is a single-user workspace: all conversations intentionally share
  // one browser context, profile, cookie jar, and tab strip.
  return String(userId);
}

function profilePath(userId) {
  const safeId = crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 24);
  return path.resolve(process.env.BROWSER_PROFILE_DIR || path.join(process.cwd(), 'data', 'browser-profiles'), safeId);
}

async function serialize(sessionKey, work) {
  const previous = queues.get(sessionKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  queues.set(sessionKey, tail);
  await previous;
  try { return await work(); }
  finally {
    release();
    if (queues.get(sessionKey) === tail) queues.delete(sessionKey);
  }
}

async function getContext(userId) {
  const userKey = String(userId);
  let contextPromise = profiles.get(userKey);
  if (!contextPromise) {
    contextPromise = chromium.launchPersistentContext(profilePath(userId), {
      headless: true,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
      viewport: { width: 1365, height: 850 },
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    }).then((context) => {
      context.on('page', (page) => {
        const session = sessions.get(userKey);
        if (session) {
          session.pages = context.pages().filter((entry) => !entry.isClosed());
          session.current = session.pages.indexOf(page);
        }
      });
      return context;
    });
    profiles.set(userKey, contextPromise);
  }
  try { return await contextPromise; }
  catch (error) {
    if (profiles.get(userKey) === contextPromise) profiles.delete(userKey);
    throw error;
  }
}

async function getSession(userId, conversationId) {
  const sessionKey = keyFor(userId);
  let session = sessions.get(sessionKey);
  if (!session) {
    let starting = sessionStarts.get(sessionKey);
    if (!starting) {
      starting = (async () => {
        const context = await getContext(userId);
        const page = await context.newPage();
        const created = { userId: String(userId), pages: [page], current: 0 };
        sessions.set(sessionKey, created);
        return created;
      })();
      sessionStarts.set(sessionKey, starting);
    }
    try { session = await starting; }
    finally { if (sessionStarts.get(sessionKey) === starting) sessionStarts.delete(sessionKey); }
  }
  const context = await getContext(userId);
  session.pages = context.pages().filter((page) => !page.isClosed());
  session.pages = session.pages.filter((page) => !page.isClosed());
  if (session.pages.length === 0) {
    const context = await getContext(userId);
    session.pages.push(await context.newPage());
    session.current = 0;
  }
  session.current = Math.min(session.current, session.pages.length - 1);
  return session;
}

function activePage(session) { return session.pages[session.current]; }

function httpUrl(raw) {
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https pages can be opened.');
  }
  return parsed.href;
}

async function pageState(page) {
  return page.evaluate(() => {
    const selectors = 'a,button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[tabindex]';
    const all = [...document.querySelectorAll(selectors)];
    const elements = [];
    for (const element of all) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
      const id = String(elements.length + 1);
      element.setAttribute('data-librechat-browser-ref', id);
      const label = element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.innerText || element.getAttribute('name') || '';
      elements.push({ id, tag: element.tagName.toLowerCase(), type: element.getAttribute('type') || '', label: label.trim().replace(/\s+/g, ' ').slice(0, 140), href: element.tagName === 'A' ? element.href : undefined });
      if (elements.length >= 100) break;
    }
    return { title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 12000), elements };
  });
}

async function navigate(userId, conversationId, url, newTab = false) {
  const session = await getSession(userId);
  return serialize(keyFor(userId), async () => {
    if (newTab) {
      const context = await getContext(userId);
      const page = await context.newPage();
      session.pages = context.pages().filter((entry) => !entry.isClosed());
      session.current = session.pages.indexOf(page);
    }
    if (url) {
      await activePage(session).goto(httpUrl(url), { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    return pageState(activePage(session));
  });
}

async function act(userId, conversationId, action, args = {}) {
  const session = await getSession(userId);
  return serialize(keyFor(userId), async () => {
    const page = activePage(session);
    switch (action) {
      case 'snapshot': break;
      case 'click':
        if (!/^\d+$/.test(String(args.elementId))) throw new Error('Use an element ID from a fresh browser snapshot.');
        await page.locator(`[data-librechat-browser-ref="${Number(args.elementId)}"]`).click({ timeout: 15000 });
        break;
      case 'type':
        if (args.elementId) await page.locator(`[data-librechat-browser-ref="${Number(args.elementId)}"]`).fill(String(args.text ?? ''), { timeout: 15000 });
        else await page.keyboard.insertText(String(args.text ?? ''));
        break;
      case 'press': await page.keyboard.press(args.key); break;
      case 'scroll': await page.mouse.wheel(0, args.direction === 'up' ? -650 : 650); break;
      case 'back': await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null); break;
      case 'new_tab': {
        const context = await getContext(userId);
        const newPage = await context.newPage();
        session.pages = context.pages().filter((entry) => !entry.isClosed());
        session.current = session.pages.indexOf(newPage);
        if (args.url) await activePage(session).goto(httpUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 45000 });
        break;
      }
      case 'switch_tab':
        if (!Number.isInteger(args.tabIndex) || args.tabIndex < 0 || args.tabIndex >= session.pages.length) throw new Error('Invalid tab index.');
        session.current = args.tabIndex;
        break;
      case 'list_tabs':
        return { tabs: await Promise.all(session.pages.map(async (tab, index) => ({ index, url: tab.url(), title: await tab.title(), active: index === session.current }))) };
      default: throw new Error('Unsupported browser action.');
    }
    return pageState(activePage(session));
  });
}

async function screenshot(userId, conversationId) {
  const session = await getSession(userId);
  return serialize(keyFor(userId), () => activePage(session).screenshot({ type: 'jpeg', quality: 72, timeout: 10000 }));
}

async function tabs(userId, conversationId) {
  const session = await getSession(userId);
  return serialize(keyFor(userId), async () => Promise.all(session.pages.map(async (page, index) => ({ index, url: page.url(), title: await page.title(), active: index === session.current }))));
}

async function remoteInput(userId, conversationId, input) {
  const session = await getSession(userId);
  return serialize(keyFor(userId), async () => {
    const page = activePage(session);
    if (input.action === 'navigate') {
      await page.goto(httpUrl(input.url), { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    else if (input.action === 'click') await page.mouse.click(input.x, input.y);
    else if (input.action === 'type') await page.keyboard.insertText(input.text || '');
    else if (input.action === 'press') await page.keyboard.press(input.key);
    else if (input.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    else if (input.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    else if (input.action === 'scroll') await page.mouse.wheel(0, Number(input.deltaY) || 600);
    else if (input.action === 'switch') {
      if (!Number.isInteger(input.index) || input.index < 0 || input.index >= session.pages.length) throw new Error('Invalid tab index.');
      session.current = input.index;
    } else if (input.action === 'new-tab') {
      const context = await getContext(userId);
      const newPage = await context.newPage();
      session.pages = context.pages().filter((entry) => !entry.isClosed());
      session.current = session.pages.indexOf(newPage);
    }
    return { state: await pageState(activePage(session)), tabs: await Promise.all(session.pages.map(async (tab, index) => ({ index, url: tab.url(), title: await tab.title(), active: index === session.current }))) };
  });
}

async function closeAll() {
  for (const contextPromise of profiles.values()) {
    try { const context = await contextPromise; await context.close(); } catch { /* already closed */ }
  }
  profiles.clear();
  sessions.clear();
  sessionStarts.clear();
}

module.exports = { getSession, pageState, navigate, act, screenshot, tabs, remoteInput, closeAll };
