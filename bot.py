import os
import re
import requests
from bs4 import BeautifulSoup
from typing import Optional
from datetime import datetime, timezone

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
    """Scrape the target URL and extract the last updated date."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Try <time datetime="..."> first
    time_tag = soup.find("time", attrs={"datetime": True})
    if time_tag:
        dt_str = time_tag["datetime"]
        # Handle dates like "2026-03-3" -> "2026-03-03"
        parts = dt_str.split("-")
        if len(parts) == 3:
            dt_str = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
        return datetime.fromisoformat(dt_str).replace(tzinfo=timezone.utc)

    # Fallback: look for "Last updated: <date>" text
    text = soup.get_text()
    match = re.search(r"Last updated:\s*(\d{1,2}\s+\w+,?\s*\d{4})", text)
    if match:
        date_str = match.group(1).replace(",", "")
        return datetime.strptime(date_str, "%d %B %Y").replace(tzinfo=timezone.utc)

    return None


def send_telegram(message: str):
    """Send a message to the configured Telegram chat."""
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    resp = requests.post(url, json={"chat_id": CHAT_ID, "text": message, "parse_mode": "HTML"})
    resp.raise_for_status()
    print(f"Message sent: {resp.json()['ok']}")


def main():
    now = datetime.now(timezone.utc)
    outdated = []
    errors = []

    for site in SITES:
        try:
            last_updated = get_last_updated(site["url"])
            if last_updated is None:
                errors.append(site["name"])
                continue

            days_since = (now - last_updated).days
            print(f"{site['name']}: updated {last_updated.date()} ({days_since} days ago)")

            if days_since > MAX_DAYS:
                outdated.append({
                    "name": site["name"],
                    "url": site["url"],
                    "days": days_since,
                    "date": last_updated.strftime("%d %B %Y"),
                })
        except Exception as e:
            print(f"Error checking {site['name']}: {e}")
            errors.append(site["name"])

    if not outdated and not errors:
        print("All sites are up to date!")
        return

    lines = []
    if outdated:
        lines.append("🔴 <b>Webs sin actualizar:</b>\n")
        for s in outdated:
            lines.append(
                f"• <b>{s['name']}</b>\n"
                f"  📅 {s['date']} ({s['days']} dias)\n"
                f"  🔗 {s['url']}"
            )

    if errors:
        lines.append("\n⚠️ <b>No pude leer la fecha en:</b>")
        for name in errors:
            lines.append(f"• {name}")

    send_telegram("\n".join(lines))


if __name__ == "__main__":
    main()
