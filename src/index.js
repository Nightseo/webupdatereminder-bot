const SITES = [
  { name: "CortijoLaPasion", url: "https://mexico-bot.pages.dev/" },
  { name: "ConsejoProcuradores", url: "https://byeprocu-bot.pages.dev/" },
  { name: "FlowerHome", url: "https://flowerhome-bot-9r5.pages.dev/" },
  { name: "BudsAndBrews", url: "https://buds-bot.pages.dev/" },
  { name: "VeracruzAlterno", url: "https://vera-bot.pages.dev/" },
];

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

// ── Scraping ────────────────────────────────────────

async function getLastUpdated(url) {
  const resp = await fetch(url);
  const html = await resp.text();

  // Try <time datetime="...">
  const timeMatch = html.match(/<time[^>]+datetime="([^"]+)"/);
  if (timeMatch) {
    let dt = timeMatch[1];
    const parts = dt.split("-");
    if (parts.length === 3) {
      dt = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
    return new Date(dt + "T00:00:00Z");
  }

  // Fallback: "Last updated: 5 March, 2026"
  const textMatch = html.match(/Last updated:\s*(\d{1,2}\s+\w+,?\s*\d{4})/);
  if (textMatch) {
    const cleaned = textMatch[1].replace(",", "");
    return new Date(cleaned);
  }

  return null;
}

function buildStatus(daysSince, maxDays) {
  if (daysSince > maxDays) return ["\u{1F6A8}", `ACTUALIZAR  \u00b7  ${daysSince} dias sin cambios`];
  if (daysSince === maxDays) return ["\u26a0\ufe0f", "ACTUALIZAR HOY"];
  if (daysSince === maxDays - 1) return ["\u{1F7E1}", "Queda 1 dia"];
  return ["\u2705", `Al dia  \u00b7  ${maxDays - daysSince} dias restantes`];
}

async function buildReport(maxDays) {
  const now = new Date();
  const spain = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  const weekday = DAY_NAMES[spain.getDay()];
  const dateStr = `${String(spain.getDate()).padStart(2, "0")}/${String(spain.getMonth() + 1).padStart(2, "0")}/${spain.getFullYear()}`;

  const lines = [
    `\u{1F4CB}  <b>Web Update Report</b>`,
    `\u{1F4C5}  ${weekday}, ${dateStr}`,
    "\u2500".repeat(24),
  ];

  const results = [];
  for (const site of SITES) {
    try {
      const lastUpdated = await getLastUpdated(site.url);
      if (!lastUpdated) {
        results.push({ name: site.name, lastUpdated: null, daysSince: null, status: null });
        continue;
      }
      const daysSince = Math.floor((now - lastUpdated) / 86400000);
      const [emoji, status] = buildStatus(daysSince, maxDays);
      results.push({ name: site.name, lastUpdated, daysSince, status: [emoji, status] });
    } catch (e) {
      results.push({ name: site.name, lastUpdated: null, daysSince: null, status: null });
    }
  }

  results.sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1));

  for (const r of results) {
    lines.push("");
    if (!r.status) {
      lines.push(`\u2753  <b>${r.name}</b>`);
      lines.push("      No se pudo leer la fecha");
    } else {
      const [emoji, status] = r.status;
      const d = r.lastUpdated;
      const edited = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
      lines.push(`${emoji}  <b>${r.name}</b>`);
      lines.push(`      ${status}`);
      lines.push(`      <i>Editado: ${edited}</i>`);
    }
  }

  lines.push("");
  lines.push("\u2500".repeat(24));
  const total = results.length;
  const urgent = results.filter((r) => r.daysSince !== null && r.daysSince >= maxDays).length;
  lines.push(`\u{1F4CA}  ${total} webs  \u00b7  ${urgent} necesitan atencion`);

  return lines.join("\n");
}

// ── Telegram ────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function editTelegram(token, chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }),
  });
}

// ── PrimeIndexer ────────────────────────────────────

async function indexUrls(apiKey, projectName, urls) {
  const resp = await fetch("https://app.primeindexer.com/api/v1/projects", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name: projectName, urls }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`${resp.status}: ${body.slice(0, 200)}`);
  }
  return await resp.json();
}

// ── Command handlers ────────────────────────────────

async function handleStart(token, chatId) {
  await sendTelegram(
    token,
    chatId,
    "\u{1F44B}  <b>Web Update Reminder</b>\n\n" +
      "<b>Comandos:</b>\n" +
      "/status \u2014 Revisar estado de las webs\n" +
      "/indexar \u2014 Indexar URLs en PrimeIndexer\n\n" +
      "<i>Formato de /indexar:</i>\n" +
      "<code>/indexar NombreProyecto\nhttps://url1.com\nhttps://url2.com</code>"
  );
}

async function handleStatus(token, chatId, maxDays) {
  const waitMsg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: "\u23f3 Revisando webs..." }),
  }).then((r) => r.json());

  const report = await buildReport(maxDays);
  await editTelegram(token, chatId, waitMsg.result.message_id, report);
}

async function handleIndexar(token, chatId, text, primeindexerKey) {
  const content = text.replace(/^\/indexar\s*/, "").trim();
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    await sendTelegram(
      token,
      chatId,
      "\u26a0\ufe0f  <b>Formato incorrecto</b>\n\n<i>Uso:</i>\n<code>/indexar NombreProyecto\nhttps://url1.com\nhttps://url2.com</code>"
    );
    return;
  }

  const projectName = lines[0];
  const urls = lines.slice(1).filter((u) => u.startsWith("http"));

  if (!urls.length) {
    await sendTelegram(token, chatId, "\u26a0\ufe0f  No se encontraron URLs validas.");
    return;
  }

  const waitMsg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `\u23f3 Indexando ${urls.length} URL(s) en <b>${projectName}</b>...`,
      parse_mode: "HTML",
    }),
  }).then((r) => r.json());

  try {
    await indexUrls(primeindexerKey, projectName, urls);
    const urlList = urls.map((u) => `  \u2022 ${u}`).join("\n");
    const now = new Date();
    const spain = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
    const date = `${String(spain.getDate()).padStart(2, "0")}/${String(spain.getMonth() + 1).padStart(2, "0")}/${spain.getFullYear()}`;
    const time = `${String(spain.getHours()).padStart(2, "0")}:${String(spain.getMinutes()).padStart(2, "0")}`;
    await editTelegram(
      token,
      chatId,
      waitMsg.result.message_id,
      `\u2705  <b>Indexacion enviada</b>\n\n` +
      `\u{1F4C1}  <b>${projectName}</b>\n` +
      `\u{1F4C5}  ${date} a las ${time}\n` +
      `\u{1F517}  ${urls.length} URL(s):\n${urlList}\n\n` +
      `<i>Las URLs se indexaran automaticamente.</i>`
    );
  } catch (e) {
    await editTelegram(
      token,
      chatId,
      waitMsg.result.message_id,
      `\u274c  <b>Error al indexar</b>\n\n<code>${e.message.slice(0, 200)}</code>`
    );
  }
}

// ── Worker entry ────────────────────────────────────

export default {
  // Webhook: receives Telegram updates
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK");
    }

    try {
      const update = await request.json();
      const message = update.message;
      if (!message || !message.text) return new Response("OK");

      const chatId = message.chat.id;
      const text = message.text;

      if (text.startsWith("/start")) {
        await handleStart(env.TELEGRAM_TOKEN, chatId);
      } else if (text.startsWith("/status")) {
        await handleStatus(env.TELEGRAM_TOKEN, chatId, parseInt(env.MAX_DAYS || "3"));
      } else if (text.startsWith("/indexar")) {
        await handleIndexar(env.TELEGRAM_TOKEN, chatId, text, env.PRIMEINDEXER_KEY);
      }
    } catch (e) {
      console.error("Error handling update:", e);
    }

    return new Response("OK");
  },

  // Cron: daily report at 7:00 Spain
  async scheduled(event, env) {
    const report = await buildReport(parseInt(env.MAX_DAYS || "3"));
    await sendTelegram(env.TELEGRAM_TOKEN, env.CHAT_ID, report);
  },
};
