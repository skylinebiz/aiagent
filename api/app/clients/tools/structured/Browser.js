const { z } = require('zod');
const { DynamicStructuredTool } = require('@librechat/agents/langchain/tools');
const BrowserSession = require('~/server/services/BrowserSession');

const schema = z.object({
  action: z.enum(['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'back', 'new_tab', 'switch_tab', 'list_tabs']),
  url: z.string().optional().describe('Full http/https URL for navigate, or optional URL for a new tab.'),
  new_tab: z.boolean().optional().describe('When navigating, open the URL in a new tab.'),
  element_id: z.string().optional().describe('Element ID from a fresh snapshot for click or type.'),
  text: z.string().optional().describe('Text to fill into the selected input.'),
  key: z.string().optional().describe('Keyboard key such as Enter, Tab, or Escape.'),
  direction: z.enum(['up', 'down']).optional(),
  tab_index: z.number().int().min(0).optional(),
});

class BrowserTool extends DynamicStructuredTool {
  constructor(fields = {}) {
    const userId = fields.userId;
    super({
      name: 'browser',
      description: 'Operate the shared server-side browser. Start with snapshot, then navigate/click/type/press. The user sees the browser window live in the chat Browser panel. Tabs and login cookies are shared across chats for this user.',
      schema,
      func: async ({ action, url, new_tab, element_id, text, key, direction, tab_index }) => {
        if (action === 'navigate') {
          if (!url) throw new Error('A URL is required to navigate.');
          return JSON.stringify(await BrowserSession.navigate(userId, 'shared', url, new_tab));
        }
        if (action === 'list_tabs') {
          return JSON.stringify({ tabs: await BrowserSession.tabs(userId, 'shared') });
        }
        const result = await BrowserSession.act(userId, 'shared', action, {
          elementId: element_id,
          text,
          key,
          direction,
          tabIndex: tab_index,
          url,
        });
        return JSON.stringify(result);
      },
    });
  }
}

module.exports = BrowserTool;
