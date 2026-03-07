const DEFAULT_SITES = [
  { name: "CortijoLaPasion", url: "https://mexico-bot.pages.dev/" },
  { name: "ConsejoProcuradores", url: "https://byeprocu-bot.pages.dev/" },
  { name: "FlowerHome", url: "https://flowerhome-bot-9r5.pages.dev/" },
  { name: "BudsAndBrews", url: "https://buds-bot.pages.dev/" },
  { name: "VeracruzAlterno", url: "https://vera-bot.pages.dev/" },
];

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];

// ── KV helpers ──────────────────────────────────────

async function getSites(kv) {
  const data = await kv.get("sites", "json");
  return data || DEFAULT_SITES;
}

async function saveSites(kv, sites) {
  await kv.put("sites", JSON.stringify(sites));
}

// ── Spain time helper ───────────────────────────────

function spainNow() {
  const now = new Date();
  const spain = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Madrid" }));
  return spain;
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function formatTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── Scraping ────────────────────────────────────────

async function getLastUpdated(url) {
  const resp = await fetch(url);
  const html = await resp.text();

  const timeMatch = html.match(/<time[^>]+datetime="([^"]+)"/);
  if (timeMatch) {
    let dt = timeMatch[1];
    const parts = dt.split("-");
    if (parts.length === 3) {
      dt = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
    }
    return new Date(dt + "T00:00:00Z");
  }

  const textMatch = html.match(/Last updated:\s*(\d{1,2}\s+\w+,?\s*\d{4})/);
  if (textMatch) {
    return new Date(textMatch[1].replace(",", ""));
  }

  return null;
}

function buildStatus(daysSince, maxDays) {
  if (daysSince > maxDays) return ["\u{1F6A8}", `ACTUALIZAR  \u00b7  ${daysSince} dias sin cambios`];
  if (daysSince === maxDays) return ["\u26a0\ufe0f", "ACTUALIZAR HOY"];
  if (daysSince === maxDays - 1) return ["\u{1F7E1}", "Queda 1 dia"];
  return ["\u2705", `Al dia  \u00b7  ${maxDays - daysSince} dias restantes`];
}

async function buildReport(sites, maxDays) {
  const now = new Date();
  const spain = spainNow();
  const weekday = DAY_NAMES[spain.getDay()];

  const lines = [
    `\u{1F4CB}  <b>Web Update Report</b>`,
    `\u{1F4C5}  ${weekday}, ${formatDate(spain)}`,
    "\u2500".repeat(24),
  ];

  const results = [];
  for (const site of sites) {
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
  const urgent = results.filter((r) => r.daysSince !== null && r.daysSince >= maxDays).length;
  lines.push(`\u{1F4CA}  ${results.length} webs  \u00b7  ${urgent} necesitan atencion`);

  return lines.join("\n");
}

// ── Telegram ────────────────────────────────────────

async function sendTelegram(token, chatId, text) {
  return fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  }).then((r) => r.json());
}

async function editTelegram(token, chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }),
  });
}

// ── Google Search Console ───────────────────────────

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGscAccessToken(credentialsB64) {
  const creds = JSON.parse(atob(credentialsB64));
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));

  // Import private key
  const pemBody = creds.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "").replace(/\n/g, "");
  const keyBuf = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBuf, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);

  // Sign JWT
  const signInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signInput));
  const jwt = `${signInput}.${base64url(signature)}`;

  // Exchange for access token
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(data.error_description || "Failed to get access token");
  return data.access_token;
}

async function queryGsc(accessToken, siteUrl, startDate, endDate, dimensions, rowLimit) {
  const body = { startDate, endDate, dataState: "all" };
  if (dimensions) body.dimensions = dimensions;
  if (rowLimit) body.rowLimit = rowLimit;
  const resp = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GSC API ${resp.status}: ${err.slice(0, 200)}`);
  }
  return await resp.json();
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
      "/ping \u2014 Comprobar si las webs estan online\n" +
      "/webs \u2014 Listar todas las webs\n" +
      "/addweb \u2014 Anadir una web nueva\n" +
      "/removeweb \u2014 Eliminar una web\n" +
      "/indexar \u2014 Indexar URLs en PrimeIndexer\n" +
      "/gsc \u2014 Clicks y keywords de Google Search Console\n\n" +
      "<i>Formatos:</i>\n" +
      "<code>/addweb Nombre https://url.com</code>\n" +
      "<code>/removeweb Nombre</code>\n" +
      "<code>/indexar NombreProyecto\nhttps://url1.com\nhttps://url2.com</code>\n" +
      "<code>/gsc FlowerHome</code>"
  );
}

async function handleStatus(token, chatId, kv, maxDays) {
  const waitMsg = await sendTelegram(token, chatId, "\u23f3 Revisando webs...");
  const sites = await getSites(kv);
  const report = await buildReport(sites, maxDays);
  await editTelegram(token, chatId, waitMsg.result.message_id, report);
}

async function handlePing(token, chatId, kv) {
  const waitMsg = await sendTelegram(token, chatId, "\u23f3 Haciendo ping a todas las webs...");
  const sites = await getSites(kv);
  const spain = spainNow();

  const lines = [
    `\u{1F3D3}  <b>Ping Report</b>`,
    `\u{1F4C5}  ${formatDate(spain)}, ${formatTime(spain)}`,
    "\u2500".repeat(24),
  ];

  for (const site of sites) {
    try {
      const start = Date.now();
      const resp = await fetch(site.url, { method: "HEAD", redirect: "follow" });
      const ms = Date.now() - start;

      if (resp.ok) {
        const speed = ms < 500 ? "\u26a1" : ms < 1500 ? "\u{1F7E1}" : "\u{1F534}";
        lines.push(`\n\u2705  <b>${site.name}</b>\n      ${resp.status} OK  \u00b7  ${ms}ms ${speed}`);
      } else {
        lines.push(`\n\u{1F6A8}  <b>${site.name}</b>\n      HTTP ${resp.status}  \u00b7  ${ms}ms`);
      }
    } catch (e) {
      lines.push(`\n\u274c  <b>${site.name}</b>\n      No responde`);
    }
  }

  lines.push("");
  lines.push("\u2500".repeat(24));
  lines.push(`\u{1F4CA}  ${sites.length} webs comprobadas`);

  await editTelegram(token, chatId, waitMsg.result.message_id, lines.join("\n"));
}

async function handleWebs(token, chatId, kv) {
  const sites = await getSites(kv);

  if (!sites.length) {
    await sendTelegram(token, chatId, "\u{1F4CB}  No hay webs configuradas.\n\nUsa <code>/addweb Nombre url</code> para anadir una.");
    return;
  }

  const lines = [`\u{1F4CB}  <b>Webs configuradas</b> (${sites.length})\n`, "\u2500".repeat(24)];
  for (const s of sites) {
    lines.push(`\n\u{1F310}  <b>${s.name}</b>\n      ${s.url}`);
  }

  await sendTelegram(token, chatId, lines.join("\n"));
}

async function handleAddWeb(token, chatId, text, kv) {
  const content = text.replace(/^\/addweb\s*/, "").trim();
  const parts = content.split(/\s+/);

  if (parts.length < 2 || !parts[1].startsWith("http")) {
    await sendTelegram(token, chatId, "\u26a0\ufe0f  <b>Formato:</b>\n<code>/addweb Nombre https://url.com</code>");
    return;
  }

  const name = parts[0];
  const url = parts[1];
  const sites = await getSites(kv);

  if (sites.find((s) => s.name.toLowerCase() === name.toLowerCase())) {
    await sendTelegram(token, chatId, `\u26a0\ufe0f  Ya existe una web con el nombre <b>${name}</b>.`);
    return;
  }

  sites.push({ name, url });
  await saveSites(kv, sites);

  await sendTelegram(
    token,
    chatId,
    `\u2705  <b>Web anadida</b>\n\n\u{1F310}  <b>${name}</b>\n\u{1F517}  ${url}\n\n<i>Total: ${sites.length} webs</i>`
  );
}

async function handleRemoveWeb(token, chatId, text, kv) {
  const name = text.replace(/^\/removeweb\s*/, "").trim();

  if (!name) {
    await sendTelegram(token, chatId, "\u26a0\ufe0f  <b>Formato:</b>\n<code>/removeweb Nombre</code>");
    return;
  }

  const sites = await getSites(kv);
  const idx = sites.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());

  if (idx === -1) {
    const available = sites.map((s) => s.name).join(", ");
    await sendTelegram(token, chatId, `\u26a0\ufe0f  No encontre <b>${name}</b>.\n\n<i>Webs disponibles: ${available}</i>`);
    return;
  }

  const removed = sites.splice(idx, 1)[0];
  await saveSites(kv, sites);

  await sendTelegram(
    token,
    chatId,
    `\u{1F5D1}  <b>Web eliminada</b>\n\n\u{1F310}  <b>${removed.name}</b>\n\u{1F517}  ${removed.url}\n\n<i>Quedan: ${sites.length} webs</i>`
  );
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

  const waitMsg = await sendTelegram(
    token,
    chatId,
    `\u23f3 Indexando ${urls.length} URL(s) en <b>${projectName}</b>...`
  );

  try {
    await indexUrls(primeindexerKey, projectName, urls);
    const urlList = urls.map((u) => `  \u2022 ${u}`).join("\n");
    const spain = spainNow();
    await editTelegram(
      token,
      chatId,
      waitMsg.result.message_id,
      `\u2705  <b>Indexacion enviada</b>\n\n` +
        `\u{1F4C1}  <b>${projectName}</b>\n` +
        `\u{1F4C5}  ${formatDate(spain)} a las ${formatTime(spain)}\n` +
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

async function handleGsc(token, chatId, text, kv, gscCredentials) {
  const name = text.replace(/^\/gsc\s*/, "").trim();
  const properties = (await kv.get("gsc_properties", "json")) || {};

  if (!name) {
    const available = Object.keys(properties);
    if (!available.length) {
      await sendTelegram(token, chatId, "\u26a0\ufe0f  No hay propiedades GSC configuradas.");
      return;
    }
    await sendTelegram(
      token, chatId,
      `\u26a0\ufe0f  <b>Indica la web:</b>\n<code>/gsc ${available[0]}</code>\n\n<i>Disponibles: ${available.join(", ")}</i>`
    );
    return;
  }

  const siteUrl = properties[name] || properties[Object.keys(properties).find((k) => k.toLowerCase() === name.toLowerCase())];
  if (!siteUrl) {
    const available = Object.keys(properties).join(", ");
    await sendTelegram(token, chatId, `\u26a0\ufe0f  <b>${name}</b> no tiene propiedad GSC.\n\n<i>Disponibles: ${available}</i>`);
    return;
  }

  const waitMsg = await sendTelegram(token, chatId, `\u23f3 Consultando GSC para <b>${name}</b>...`);

  try {
    const accessToken = await getGscAccessToken(gscCredentials);

    // Yesterday + day before for comparison
    const now = new Date();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const dayBefore = new Date(now); dayBefore.setDate(dayBefore.getDate() - 2);
    const dateY = yesterday.toISOString().split("T")[0];
    const dateDB = dayBefore.toISOString().split("T")[0];

    // 3 queries: yesterday totals, day-before totals, yesterday keywords
    const [totals, prevTotals, keywords] = await Promise.all([
      queryGsc(accessToken, siteUrl, dateY, dateY, null, null),
      queryGsc(accessToken, siteUrl, dateDB, dateDB, null, null),
      queryGsc(accessToken, siteUrl, dateY, dateY, ["query"], 25),
    ]);

    const spain = spainNow();
    const lines = [
      `\u{1F4CA}  <b>GSC Report: ${name}</b>`,
      `\u{1F4C5}  ${formatDate(spain)}, ${formatTime(spain)}`,
      `\u{1F310}  ${siteUrl}`,
      `\u{1F4C6}  Ultimas 24h`,
      "\u2500".repeat(24),
    ];

    if (totals.rows && totals.rows.length) {
      const t = totals.rows[0];
      const ctr = (t.ctr * 100).toFixed(1);
      const pos = t.position.toFixed(1);

      let diffLine = "";
      if (prevTotals.rows && prevTotals.rows.length) {
        const p = prevTotals.rows[0];
        const diffClicks = t.clicks - p.clicks;
        const diffImp = t.impressions - p.impressions;
        const sign = (n) => n > 0 ? `+${n}` : `${n}`;
        const arrow = (n) => n > 0 ? "\u{1F53C}" : n < 0 ? "\u{1F53D}" : "\u25AA\uFE0F";
        diffLine = `\n${arrow(diffClicks)}  vs ayer: ${sign(diffClicks)} clicks  \u00b7  ${sign(diffImp)} impresiones`;
      }

      lines.push(
        `\n\u{1F4C8}  <b>${t.clicks}</b> clicks  \u00b7  <b>${t.impressions.toLocaleString()}</b> impresiones` +
        `\n\u{1F4CA}  CTR: ${ctr}%  \u00b7  Posicion media: ${pos}` +
        diffLine
      );
    } else {
      lines.push("\nNo hay datos para este periodo.");
    }

    if (keywords.rows && keywords.rows.length) {
      // Calculate average impressions and filter keywords above it
      const avgImp = keywords.rows.reduce((s, r) => s + r.impressions, 0) / keywords.rows.length;
      const filtered = keywords.rows.filter((r) => r.impressions >= avgImp).slice(0, 10);

      lines.push(`\n<b>Top keywords:</b>\n`);
      for (let i = 0; i < filtered.length; i++) {
        const row = filtered[i];
        const pos = row.position ? row.position.toFixed(1) : "-";
        lines.push(
          `  ${i + 1}. <b>${row.keys[0]}</b>\n` +
          `      ${row.clicks} clicks  \u00b7  ${row.impressions} imp  \u00b7  pos ${pos}`
        );
      }
    }

    await editTelegram(token, chatId, waitMsg.result.message_id, lines.join("\n"));
  } catch (e) {
    await editTelegram(
      token, chatId, waitMsg.result.message_id,
      `\u274c  <b>Error GSC</b>\n\n<code>${e.message.slice(0, 300)}</code>`
    );
  }
}

// ── Worker entry ────────────────────────────────────

export default {
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
      const cmd = text.split("@")[0]; // handle /command@botname in groups

      if (cmd.startsWith("/start")) {
        await handleStart(env.TELEGRAM_TOKEN, chatId);
      } else if (cmd.startsWith("/status")) {
        await handleStatus(env.TELEGRAM_TOKEN, chatId, env.SITES_KV, parseInt(env.MAX_DAYS || "3"));
      } else if (cmd.startsWith("/ping")) {
        await handlePing(env.TELEGRAM_TOKEN, chatId, env.SITES_KV);
      } else if (cmd.startsWith("/webs")) {
        await handleWebs(env.TELEGRAM_TOKEN, chatId, env.SITES_KV);
      } else if (cmd.startsWith("/addweb")) {
        await handleAddWeb(env.TELEGRAM_TOKEN, chatId, text, env.SITES_KV);
      } else if (cmd.startsWith("/removeweb")) {
        await handleRemoveWeb(env.TELEGRAM_TOKEN, chatId, text, env.SITES_KV);
      } else if (cmd.startsWith("/indexar")) {
        await handleIndexar(env.TELEGRAM_TOKEN, chatId, text, env.PRIMEINDEXER_KEY);
      } else if (cmd.startsWith("/gsc")) {
        await handleGsc(env.TELEGRAM_TOKEN, chatId, text, env.SITES_KV, env.GSC_CREDENTIALS);
      }
    } catch (e) {
      console.error("Error handling update:", e);
    }

    return new Response("OK");
  },

  async scheduled(event, env) {
    const sites = await getSites(env.SITES_KV);

    // Daily report at 6:00 UTC (7:00 Spain)
    if (event.cron === "0 6 * * *") {
      const report = await buildReport(sites, parseInt(env.MAX_DAYS || "3"));
      await sendTelegram(env.TELEGRAM_TOKEN, env.CHAT_ID, report);
      return;
    }

    // Hourly uptime check - only alert if something is down
    const down = [];
    for (const site of sites) {
      try {
        const resp = await fetch(site.url, { method: "HEAD", redirect: "follow" });
        if (!resp.ok) down.push({ name: site.name, url: site.url, reason: `HTTP ${resp.status}` });
      } catch (e) {
        down.push({ name: site.name, url: site.url, reason: "No responde" });
      }
    }

    if (down.length === 0) return; // all good, silence

    const spain = spainNow();
    const lines = [
      `\u{1F6A8}  <b>ALERTA DE CAIDA</b>`,
      `\u{1F4C5}  ${formatDate(spain)}, ${formatTime(spain)}`,
      "\u2500".repeat(24),
    ];
    for (const d of down) {
      lines.push(`\n\u274c  <b>${d.name}</b>\n      ${d.reason}\n      ${d.url}`);
    }
    lines.push(`\n\u2500`.repeat(24));
    lines.push(`\n\u26a0\ufe0f  ${down.length} de ${sites.length} webs caidas`);

    await sendTelegram(env.TELEGRAM_TOKEN, env.CHAT_ID, lines.join("\n"));
  },
};
