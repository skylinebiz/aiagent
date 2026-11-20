"""Telegram-controlled, visible Browser Use agent."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from dotenv import load_dotenv
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

load_dotenv()

LOG = logging.getLogger("browser_use")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


@dataclass
class Job:
    chat_id: int
    user_id: int
    text: str
    kind: str = "task"


class TelegramProgress(logging.Handler):
    def __init__(self, loop: asyncio.AbstractEventLoop, app: Application):
        super().__init__(logging.INFO)
        self.loop, self.app = loop, app
        self.last_sent: dict[int, float] = {}
        self.job: Job | None = None

    def emit(self, record: logging.LogRecord) -> None:
        if not self.job or not record.getMessage().startswith("step "):
            return
        message = record.getMessage().split(" -> ", 1)[0]
        chat_id = self.job.chat_id
        self.loop.call_soon_threadsafe(
            lambda: asyncio.create_task(self.app.bot.send_message(chat_id, f"🌐 {message[:900]}"))
        )


def allowed_ids() -> set[int]:
    raw = os.getenv("TELEGRAM_ALLOWED_USER_IDS", "")
    try:
        return {int(item.strip()) for item in raw.split(",") if item.strip()}
    except ValueError as exc:
        raise RuntimeError("TELEGRAM_ALLOWED_USER_IDS must be comma-separated numeric IDs") from exc


def check_config() -> set[int]:
    ids = allowed_ids()
    if not os.getenv("TELEGRAM_BOT_TOKEN"):
        raise RuntimeError("Set TELEGRAM_BOT_TOKEN in .env")
    if not ids:
        raise RuntimeError("Set TELEGRAM_ALLOWED_USER_IDS in .env before starting the bot")
    if not any(os.getenv(key) for key in ("OPENAI_API_KEY", "BROWSER_USE_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY", "OLLAMA_BASE_URL")):
        raise RuntimeError("Configure an AI provider key or local Ollama URL; see .env.example")
    return ids


def make_llm():
    """Build a Pydantic AI model accepted by Browser Use from environment config."""
    provider = os.getenv("AI_PROVIDER", "openai").lower()
    model = os.getenv("AI_MODEL", "")
    if provider in {"browser-use", "browser_use", "bu"}:
        # No llm argument selects Browser Use's hosted gateway model.
        return None

    # Pydantic AI provider model strings support a broad set of providers. Install
    # their optional extras separately when the chosen provider requires them.
    defaults = {
        "openai": "openai:gpt-4.1", "anthropic": "anthropic:claude-sonnet-4-5",
        "google": "google-gla:gemini-2.5-pro", "google-vertex": "google-vertex:gemini-2.5-pro",
        "groq": "groq:llama-3.3-70b-versatile", "deepseek": "deepseek:deepseek-chat",
        "openrouter": "openrouter:openai/gpt-4.1", "ollama": "ollama:llama3.3",
        "azure-openai": "openai:gpt-4.1", "mistral": "mistral:mistral-large-latest",
        "cohere": "cohere:command-a-03-2025", "bedrock": "bedrock:anthropic.claude-3-5-sonnet-20241022-v2:0",
        "cerebras": "cerebras:llama-3.3-70b", "fireworks": "fireworks:accounts/fireworks/models/llama-v3p3-70b-instruct",
        "together": "together:meta-llama/Llama-3.3-70B-Instruct-Turbo",
    }
    if provider in {"openai-compatible", "compatible", "custom"}:
        base = os.getenv("AI_BASE_URL")
        if not base:
            raise RuntimeError("AI_BASE_URL is required for openai-compatible")
        from pydantic_ai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider
        return OpenAIModel(model or "gpt-4o", provider=OpenAIProvider(base_url=base, api_key=os.getenv("AI_API_KEY", "local")))
    if provider not in defaults:
        raise RuntimeError(f"Unknown AI_PROVIDER '{provider}'. See README.md")
    # Browser Use accepts Pydantic AI's provider:model string directly and
    # resolves the matching optional provider when the task starts.
    selected = model or defaults[provider]
    # Pydantic AI uses explicit provider:model strings. Let shorthand model
    # names work in .env too.
    if ":" not in selected:
        prefixes = {"openai": "openai", "anthropic": "anthropic", "google": "google-gla", "google-vertex": "google-vertex", "groq": "groq", "deepseek": "deepseek", "openrouter": "openrouter", "ollama": "ollama", "azure-openai": "openai", "mistral": "mistral", "cohere": "cohere", "bedrock": "bedrock", "cerebras": "cerebras", "fireworks": "fireworks", "together": "together"}
        selected = f"{prefixes[provider]}:{selected}"
    return selected


def clean_url(raw: str) -> str:
    value = raw.strip()
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value
    parsed = urlparse(value)
    if not parsed.hostname or parsed.scheme not in {"http", "https"}:
        raise ValueError("Send an http(s) URL, for example /open https://example.com")
    return value


class Controller:
    def __init__(self, app: Application, ids: set[int]):
        self.app, self.ids = app, ids
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.current: Job | None = None
        self.progress: TelegramProgress | None = None

    async def authorized(self, update: Update) -> bool:
        user = update.effective_user
        if user and user.id in self.ids:
            return True
        if update.effective_message:
            await update.effective_message.reply_text("Unauthorized. Ask the bot owner to add your Telegram numeric user ID.")
        return False

    async def status(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self.authorized(update): return
        queued = self.queue.qsize()
        current = f"Running: {self.current.text[:180]}" if self.current else "Idle"
        await update.effective_message.reply_text(f"{current}\nQueued tasks: {queued}\nBrowser desktop: connect using the noVNC instructions in README.md")

    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self.authorized(update): return
        await update.effective_message.reply_text("Ready. Use /open URL or /task instructions. Tasks run in order in the visible browser. Use /status to check the queue.")

    async def enqueue(self, update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str):
        if not await self.authorized(update): return
        message = update.effective_message
        payload = " ".join(context.args).strip()
        if not payload:
            await message.reply_text("Give me a URL or task after the command.")
            return
        if kind == "open":
            try: payload = f"Open {clean_url(payload)} and leave the page visible for me to use."
            except ValueError as exc:
                await message.reply_text(str(exc)); return
        job = Job(message.chat_id, update.effective_user.id, payload, kind)
        await self.queue.put(job)
        await message.reply_text(f"Queued #{self.queue.qsize()}: {payload[:350]}")

    async def task_command(self, update, context): await self.enqueue(update, context, "task")
    async def open_command(self, update, context): await self.enqueue(update, context, "open")

    async def plain_text(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        if not await self.authorized(update): return
        text = (update.effective_message.text or "").strip()
        if text:
            await self.queue.put(Job(update.effective_message.chat_id, update.effective_user.id, text))
            await update.effective_message.reply_text(f"Queued #{self.queue.qsize()}: {text[:350]}")

    async def worker(self):
        from browser_use import Agent, Browser
        llm = make_llm()
        browser = Browser("chromium", headless=False, user_data_dir=os.getenv("BROWSER_PROFILE", "./data/chrome-profile"), keep_alive=True)
        while True:
            job = await self.queue.get()
            self.current = job
            if self.progress: self.progress.job = job
            await self.app.bot.send_message(job.chat_id, f"▶️ Starting: {job.text[:350]}")
            try:
                agent_options = {"browser": browser, "max_failures": 3}
                if llm is not None:
                    agent_options["llm"] = llm
                agent = Agent(job.text, **agent_options)
                result = await agent.run(max_steps=int(os.getenv("MAX_STEPS", "30")), timeout=int(os.getenv("TASK_TIMEOUT_SECONDS", "1800")))
                answer = str(result.final_result() or "Task ended without a text result.")
                # Telegram has a 4096 character message limit.
                await self.app.bot.send_message(job.chat_id, f"✅ Finished.\n{answer[:3800]}")
            except Exception as exc:
                logging.exception("Task failed")
                await self.app.bot.send_message(job.chat_id, f"❌ Task failed: {str(exc)[:1200]}")
            finally:
                if self.progress: self.progress.job = None
                self.current = None
                self.queue.task_done()


async def post_init(app: Application):
    ids = check_config()
    ctl = Controller(app, ids)
    app.bot_data["controller"] = ctl
    ctl.progress = TelegramProgress(asyncio.get_running_loop(), app)
    LOG.addHandler(ctl.progress)
    app.create_task(ctl.worker())


def main():
    check_config()
    app = Application.builder().token(os.environ["TELEGRAM_BOT_TOKEN"]).post_init(post_init).build()
    app.add_handler(CommandHandler("start", lambda u, c: c.application.bot_data["controller"].start(u, c)))
    app.add_handler(CommandHandler("help", lambda u, c: c.application.bot_data["controller"].start(u, c)))
    app.add_handler(CommandHandler("open", lambda u, c: c.application.bot_data["controller"].open_command(u, c)))
    app.add_handler(CommandHandler("task", lambda u, c: c.application.bot_data["controller"].task_command(u, c)))
    app.add_handler(CommandHandler("status", lambda u, c: c.application.bot_data["controller"].status(u, c)))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u, c: c.application.bot_data["controller"].plain_text(u, c)))
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
