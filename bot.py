import os
import re
import requests
from typing import Optional
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta

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


def send_telegram(message: str):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    resp = requests.post(url, json={"chat_id": CHAT_ID, "text": message, "parse_mode": "HTML"})
    resp.raise_for_status()
    print(f"Message sent: {resp.json()['ok']}")


def main():
    now = datetime.now(timezone.utc)
    spain_tz = timezone(timedelta(hours=1))
    today_spain = now.astimezone(spain_tz).strftime("%d/%m/%Y")

    lines = [f"<b>Informe diario - {today_spain}</b>\n"]

    for site in SITES:
        try:
            last_updated = get_last_updated(site["url"])
            if last_updated is None:
                lines.append(f"  {site['name']}: No se pudo leer la fecha")
                continue

            days_since = (now - last_updated).days
            days_left = MAX_DAYS - days_since

            if days_since > MAX_DAYS:
                emoji = "\U0001f534"  # red circle
                status = f"Sin actualizar hace {days_since} dias!"
            elif days_left <= 1:
                emoji = "\U0001f7e1"  # yellow circle
                status = f"Actualizar hoy o manana"
            else:
                emoji = "\U0001f7e2"  # green circle
                status = f"OK - {days_left} dias restantes"

            lines.append(
                f"{emoji} <b>{site['name']}</b>\n"
                f"      Ultima: {last_updated.strftime('%d/%m/%Y')} | {status}"
            )

            print(f"{site['name']}: {days_since} days ago -> {status}")

        except Exception as e:
            print(f"Error checking {site['name']}: {e}")
            lines.append(f"  <b>{site['name']}</b>: Error al comprobar")

    send_telegram("\n".join(lines))


if __name__ == "__main__":
    main()
