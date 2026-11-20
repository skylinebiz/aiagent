# Telegram Browser Agent

Send a task to this Telegram bot. It runs Browser Use against a visible Linux Chromium desktop, keeps the browser profile between tasks, and sends task progress/results back to Telegram. Tasks enter a FIFO queue so multiple messages can be sent while an earlier task is running. Use the noVNC view from Windows to complete logins, MFA, or other manual steps in the same browser.

## 1. Configure Telegram and an AI provider

1. Create a bot with Telegram's `@BotFather` and copy its bot token.
2. Get your numeric Telegram user ID (for example from `@userinfobot`).
3. Copy `.env.example` to `.env` and fill in `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_IDS`, and a provider key/configuration.
4. Never share `.env`; it is excluded from Git.

Only the configured Telegram user IDs can control the browser. The bot uses Telegram long polling, so you do not need a public Telegram webhook or inbound port.

## 2. Linux setup and launch

On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y git xvfb x11vnc novnc websockify x11-utils python3 python3-venv python3-pip chromium
git clone https://github.com/skylinebiz/aiagent.git
cd aiagent
cp .env.example .env
nano .env
chmod +x run-linux.sh
./run-linux.sh
```

If your distribution calls the browser `chromium-browser`, the launcher detects that name too. If Chromium is elsewhere, set `BROWSER_USE_CHROMIUM_PATH=/path/to/chromium` before launching. Browser Use supports a local Chromium browser and its own persistent profile; the launcher runs Xvfb even without a physical display. noVNC and VNC listen only on Linux loopback.

## 3. View and control it from Windows

Install/use the Windows OpenSSH client, then in PowerShell start an SSH tunnel (replace the placeholders):

```powershell
ssh -N -L 6080:127.0.0.1:6080 linux-user@LINUX_HOST
```

Keep that terminal open. Open `http://127.0.0.1:6080/vnc.html` in a Windows browser and click **Connect**. This shows the Linux virtual desktop and the same Chromium window the bot is driving. If you set `NOVNC_PORT` in Linux, use that port on both sides of the forwarding command and URL.

## 4. Telegram commands

- `/start` or `/help` — show the basic help
- `/open https://example.com` — open a URL and leave it visible
- `/task find the latest invoice and summarize its due date` — run a browser task
- `/status` — show current task and queue length
- You can also send plain text as a task.

The bot sends a Telegram update for each Browser Use step and a final result. Tasks are serialized to avoid two agents controlling the same browser at once. You can enqueue additional tasks during a run. The browser remains visible and keeps cookies/local storage in `data/chrome-profile`; log in manually through noVNC when needed.

## AI provider selection

Set `AI_PROVIDER` and `AI_MODEL` in `.env`. The defaults below are examples; providers may change model names and authentication requirements. Browser Use's Python dependencies include Pydantic AI's model interface. Install the optional provider package for the provider you choose if needed.

| `AI_PROVIDER` | Example `AI_MODEL` | Key/config |
| --- | --- | --- |
| `openai` | `openai:gpt-4.1` (or `gpt-4.1`) | `OPENAI_API_KEY` |
| `anthropic` | `anthropic:claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| `google` | `google-gla:gemini-2.5-pro` | `GOOGLE_API_KEY` |
| `google-vertex` | `google-vertex:gemini-2.5-pro` | Google Cloud credentials |
| `groq` | `groq:llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `deepseek` | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| `openrouter` | `openrouter:openai/gpt-4.1` | `OPENROUTER_API_KEY` |
| `ollama` | `ollama:llama3.3` | local Ollama service |
| `azure-openai` | `gpt-4.1` | Azure OpenAI environment/config |
| `mistral` | `mistral:mistral-large-latest` | `MISTRAL_API_KEY` |
| `cohere` | `cohere:command-a-03-2025` | `CO_API_KEY` |
| `bedrock` | provider model ID | AWS credentials/region |
| `cerebras` | `cerebras:llama-3.3-70b` | `CEREBRAS_API_KEY` |
| `fireworks` | provider model ID | `FIREWORKS_API_KEY` |
| `together` | provider model ID | `TOGETHER_API_KEY` |
| `openai-compatible` | `your-model` | `AI_BASE_URL`, `AI_API_KEY` |
| `browser-use` | `bu-4.0` | `BROWSER_USE_API_KEY` |

For any compatible endpoint (including vLLM, LM Studio, and many hosted gateways), choose `openai-compatible`, set the base URL and optional API key. Provider extras are deliberately optional so the base install stays smaller; install the corresponding Pydantic AI provider extra per its current documentation.

## Operations and security

- Keep Linux SSH access restricted to trusted users. Browser login sessions and the browser debugging endpoint are sensitive.
- noVNC uses no separate password because it is bound to loopback and intended to be reached through authenticated SSH. Do not expose ports 5900 or 6080 to the public internet.
- Commands from Telegram are sent to the configured model provider as task text. Do not send secrets in Telegram; log in through the visible browser yourself.
- `/task` lets an AI agent act on websites. Review its actions in noVNC and manually handle passwords, MFA, CAPTCHAs, purchases, and other consequential confirmations.
- `MAX_STEPS` and `TASK_TIMEOUT_SECONDS` limit each task. `BROWSER_PROFILE` changes the saved profile directory.
