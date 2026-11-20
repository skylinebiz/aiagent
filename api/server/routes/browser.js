const express = require('express');
const { requireJwtAuth, configMiddleware, checkBan } = require('~/server/middleware');
const BrowserSession = require('~/server/services/BrowserSession');

const router = express.Router();
router.use(requireJwtAuth, configMiddleware, checkBan);

router.get('/state', async (req, res) => {
  try {
    const session = await BrowserSession.getSession(req.user.id);
    const tabs = await BrowserSession.tabs(req.user.id);
    const page = session.pages[session.current];
    res.set('Cache-Control', 'no-store');
    res.json({ url: page.url(), title: await page.title(), tabs });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not read browser state.' });
  }
});

router.get('/screenshot', async (req, res) => {
  try {
    const image = await BrowserSession.screenshot(req.user.id);
    res.set('Cache-Control', 'no-store');
    res.type('image/jpeg').send(image);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Could not capture browser.' });
  }
});

router.post('/input', express.json({ limit: '8kb' }), async (req, res) => {
  try {
    const result = await BrowserSession.remoteInput(req.user.id, undefined, req.body || {});
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Browser action failed.' });
  }
});

module.exports = router;
