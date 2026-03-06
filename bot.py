import os
import re
import logging
from typing import Optional
from datetime import datetime, timezone, timedelta

import requests
from bs4 import BeautifulSoup
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    CallbackQueryHandler,
    ContextTypes,
)

logging.basicConfig(level=logging.INFO)

TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]
CHAT_ID = os.environ["CHAT_ID"]
MAX_DAYS = int(os.environ.get("MAX_DAYS", "3"))

SITES = [
    {"name": "CortijoLaPasion", "url": "https://mexico-bot.pages.dev/"},
    {"name": "ConsejoProcuradores", "url": "https://byeprocu-bot.pages.dev/"},
    {"name": "FlowerHome", "url": "https://flowerhome-bot-9r5.pages.dev/"},
    {"name": "BudsAndBrews", "url": "https://buds-bot.pages.dev/"},
    {"name": "VeracruzAlterno", "url": "https://vera-bot.pages.dev/"},
]

SPAIN_TZ = timezone(timedelta(hours=1))
DAY_NAMES = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]


def get_last_updated(url: str) -> Optional[datetime]:
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    time_tag = soup.find("time", attrs={"datetime": True})
    if time_tag:
        dt_str = time_tag["datetime"]
        parts = dt_str.split("-")
        if len(parts) == 3:
            dt_str = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
        return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)

    text = soup.get_text()
    match = re.search(r"Last updated:\s*(\d{1,2}\s+\w+,?\s*\d{4})", text)
    if match:
        date_str = match.group(1).replace(",", "")
        return datetime.strptime(date_str, "%d %B %Y").replace(tzinfo=timezone.utc)

    return None


def build_status(days_since: int, max_days: int):
    if days_since > max_days:
        return "\U0001f6a8", f"ACTUALIZAR  \u00b7  {days_since} dias sin cambios"
    elif days_since == max_days:
        return "\u26a0\ufe0f", "ACTUALIZAR HOY"
    elif days_since == max_days - 1:
        return "\U0001f7e1", "Queda 1 dia"
    else:
        remaining = max_days - days_since
        return "\u2705", f"Al dia  \u00b7  {remaining} dias restantes"


def build_report() -> str:
    now = datetime.now(timezone.utc)
    today_spain = now.astimezone(SPAIN_TZ)
    weekday = DAY_NAMES[today_spain.weekday()]
    date_str = today_spain.strftime("%d/%m/%Y")

    lines = [
        f"\U0001f4cb  <b>Web Update Report</b>",
        f"\U0001f4c5  {weekday}, {date_str}",
        "\u2500" * 24,
    ]

    results = []
    for site in SITES:
        try:
            last_updated = get_last_updated(site["url"])
            if last_updated is None:
                results.append((site["name"], None, None, None))
                continue
            days_since = (now - last_updated).days
            emoji, status = build_status(days_since, MAX_DAYS)
            results.append((site["name"], last_updated, days_since, (emoji, status)))
        except Exception as e:
            logging.error(f"Error checking {site['name']}: {e}")
            results.append((site["name"], None, None, None))

    results.sort(key=lambda r: -r[2] if r[2] is not None else -1)

    for name, last_updated, days_since, status_data in results:
        lines.append("")
        if status_data is None:
            lines.append(f"\u2753  <b>{name}</b>")
            lines.append(f"      No se pudo leer la fecha")
        else:
            emoji, status = status_data
            lines.append(f"{emoji}  <b>{name}</b>")
            lines.append(f"      {status}")
            lines.append(f"      <i>Editado: {last_updated.strftime('%d/%m/%Y')}</i>")

    lines.append("")
    lines.append("\u2500" * 24)

    total = len(results)
    urgent = sum(1 for r in results if r[2] is not None and r[2] >= MAX_DAYS)
    lines.append(f"\U0001f4ca  {total} webs  \u00b7  {urgent} necesitan atencion")

    return "\n".join(lines)


KEYBOARD = InlineKeyboardMarkup([
    [InlineKeyboardButton("\U0001f504  Revisar estado", callback_data="check_status")]
])


def is_authorized(update: Update) -> bool:
    return str(update.effective_user.id) == CHAT_ID


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_authorized(update):
        await update.message.reply_text("No tienes acceso a este bot.")
        return
    await update.message.reply_text(
        "\U0001f44b  <b>Web Update Reminder</b>\n\n"
        "Te aviso cada dia a las 7:00 si alguna web necesita actualizarse.\n\n"
        "Pulsa el boton para revisar ahora:",
        parse_mode="HTML",
        reply_markup=KEYBOARD,
    )


async def cmd_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_authorized(update):
        return
    msg = await update.message.reply_text("\u23f3 Revisando webs...")
    report = build_report()
    await msg.edit_text(report, parse_mode="HTML", reply_markup=KEYBOARD)


async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    if not is_authorized(update):
        await query.answer("No tienes acceso.")
        return
    await query.answer()
    msg = await query.message.reply_text("\u23f3 Revisando webs...")
    report = build_report()
    await msg.edit_text(report, parse_mode="HTML", reply_markup=KEYBOARD)


async def scheduled_report(context: ContextTypes.DEFAULT_TYPE):
    report = build_report()
    await context.bot.send_message(
        chat_id=CHAT_ID,
        text=report,
        parse_mode="HTML",
        reply_markup=KEYBOARD,
    )


def main():
    app = Application.builder().token(TELEGRAM_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("status", cmd_status))
    app.add_handler(CallbackQueryHandler(button_handler, pattern="^check_status$"))

    # Daily report at 7:00 Spain time (6:00 UTC)
    app.job_queue.run_daily(
        scheduled_report,
        time=datetime.strptime("06:00", "%H:%M").time(),
        days=(0, 1, 2, 3, 4, 5, 6),
    )

    logging.info("Bot started. Waiting for commands...")
    app.run_polling()


if __name__ == "__main__":
    main()
