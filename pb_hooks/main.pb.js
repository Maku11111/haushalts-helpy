// ═══════════ Haushalts-Helpy KI-Parser — Routen ═══════════
// Gemeinsame Logik liegt in hh.js (PocketBase-Handler laufen in
// isolierten VMs, daher require() innerhalb jedes Handlers).

// ── Lebenszeichen (zum Testen der Installation) ──
routerAdd("GET", "/api/hh-ping", function (e) {
  return e.json(200, { ok: true, hooks: "v9" });
});

// ── Helpy-Chat: unterhalten + handeln ──
routerAdd("POST", "/api/chat", function (e) {
  var hh = require(__hooks + "/hh.js");
  var body = e.requestInfo().body;
  var messages = (body && body.messages) || [];
  if (!messages.length) return e.json(400, { error: "messages fehlt" });
  var hid = e.auth ? e.auth.get("household") : "";
  if (!hid) return e.json(400, { error: "Kein Haushalt zugeordnet" });
  try {
    var result = hh.chat(messages, hid);
    return e.json(200, { ok: true, reply: result.reply, created: result.changes });
  } catch (err) {
    return e.json(500, { error: "" + err });
  }
}, $apis.requireAuth());

// ── News zu den Hobbys des angemeldeten Nutzers ──
routerAdd("POST", "/api/news", function (e) {
  var hh = require(__hooks + "/hh.js");
  var ownerId = e.auth ? e.auth.id : "";
  var interests = [];
  try {
    var recs = $app.findRecordsByFilter("interests", "owner = '" + ownerId + "'", "name", 8, 0);
    interests = recs.map(function (r) { return r.get("name"); });
  } catch (err) {}
  // Duplikate (auch Groß/Klein) entfernen, damit 4 VERSCHIEDENE Themen geladen werden
  var seen = {}, uniq = [];
  interests.forEach(function (k) { var key = (k || "").toLowerCase().trim(); if (key && !seen[key]) { seen[key] = 1; uniq.push(k); } });
  var items = [];
  uniq.slice(0, 4).forEach(function (kw) {
    try { items = items.concat(hh.fetchNews(kw, 3)); } catch (err) {}
  });
  return e.json(200, { ok: true, interests: uniq, items: items });
}, $apis.requireAuth());

// ── Familie beitreten: authentifizierten Nutzer per Einladungscode zuordnen ──
routerAdd("POST", "/api/hh-join", function (e) {
  var hh = require(__hooks + "/hh.js");
  var body = e.requestInfo().body;
  var code = (body.code || "").toString().trim();
  if (!code) return e.json(400, { error: "Einladungscode fehlt" });
  try {
    var r = hh.linkUserToCode(e.auth.id, code);
    return e.json(200, { ok: true, household: r.householdId, householdName: r.householdName });
  } catch (err) {
    return e.json(400, { error: "" + err });
  }
}, $apis.requireAuth());

// ── Endpunkt fuer den Mikrofon-Button der App (nur angemeldete Nutzer) ──
routerAdd("POST", "/api/voice-input", function (e) {
  var hh = require(__hooks + "/hh.js");
  var body = e.requestInfo().body;
  var text = (body.text || "").toString().trim();
  if (!text) return e.json(400, { error: "text fehlt" });
  var hid = e.auth ? e.auth.get("household") : "";
  if (!hid) return e.json(400, { error: "Kein Haushalt zugeordnet" });
  try {
    var parsed = hh.parse(text, hid);
    var n = hh.apply(parsed, hid);
    return e.json(200, { ok: true, created: n, reply: parsed.reply || ("OK, " + n + " Eintraege angelegt") });
  } catch (err) {
    return e.json(500, { error: "" + err });
  }
}, $apis.requireAuth());

// ── Telegram-Webhook ──
routerAdd("POST", "/api/telegram-webhook", function (e) {
  var hh = require(__hooks + "/hh.js");
  try {
    var info = e.requestInfo();
    var headers = info.headers || {};
    var secret = headers["x_telegram_bot_api_secret_token"] || headers["X-Telegram-Bot-Api-Secret-Token"] || "";
    if (secret !== hh.TG_SECRET) return e.json(403, { error: "forbidden" });
    var msg = (info.body || {}).message;
    if (!msg) return e.json(200, { skip: true });
    var chatId = msg.chat.id;
    var reply = "";
    var text = "";
    var prefix = "";
    if (msg.voice || msg.audio) {
      try {
        text = hh.transcribe((msg.voice || msg.audio).file_id);
        prefix = "🎤 Verstanden: \"" + text + "\"\n\n";
      } catch (terr) {
        hh.tgReply(chatId, "❌ Konnte die Sprachnachricht nicht verstehen: " + terr);
        return e.json(200, { ok: true });
      }
    } else {
      text = (msg.text || "").trim();
    }
    if (!text) return e.json(200, { skip: true });
    var fromName = (msg.from && (msg.from.first_name || msg.from.username)) || "";

    // /start [CODE] – Begruessung oder Verknuepfung per Deep-Link
    if (text === "/start" || text.indexOf("/start ") === 0) {
      var param = text.length > 7 ? text.slice(7).trim() : "";
      if (param) {
        try { var r0 = hh.linkChatToCode(chatId, param, fromName); hh.tgReply(chatId, "✅ Verbunden mit „" + r0.householdName + "\"! Ab jetzt landen deine Nachrichten dort – und du bekommst jeden Morgen das Briefing. 🌅"); }
        catch (le0) { hh.tgReply(chatId, "❌ Dieser Code passt nicht. Den Familien-Code findest du in der App unter „👋 Mitglied einladen"."); }
        return e.json(200, { ok: true });
      }
      hh.tgReply(chatId, "👋 Hallo! Verbinde mich zuerst mit deiner Familie: schick mir deinen 6-stelligen Familien-Code (App → „Mitglied einladen") oder oeffne den Einladungslink. Danach kannst du mir Aufgaben/Termine/Einkaeufe diktieren.");
      return e.json(200, { ok: true });
    }
    // Reiner 6-Zeichen-Code -> Verknuepfung versuchen
    if (/^[A-Za-z0-9]{6}$/.test(text)) {
      try { var r1 = hh.linkChatToCode(chatId, text, fromName); hh.tgReply(chatId, "✅ Verbunden mit „" + r1.householdName + "\"! 🌅"); return e.json(200, { ok: true }); }
      catch (le1) { /* kein gueltiger Code -> normal weiter unten */ }
    }
    // Haushalt dieses Chats ermitteln (pro Familie)
    var hid = hh.householdForChat(chatId);
    if (!hid) {
      hh.tgReply(chatId, "🔗 Bitte zuerst verbinden: schick mir deinen 6-stelligen Familien-Code aus der App („👋 Mitglied einladen").");
      return e.json(200, { ok: true });
    }
    try {
      var parsed = hh.parse(text, hid);
      var n = hh.apply(parsed, hid);
      hh.tgReply(chatId, prefix + (parsed.reply || ("OK, " + n + " Eintraege angelegt")));
    } catch (perr) {
      hh.tgReply(chatId, "❌ Da ging was schief: " + perr);
    }
    return e.json(200, { ok: true });
  } catch (err) {
    return e.json(200, { error: "" + err });
  }
});

// ── Morgen-Briefing: auf Anfrage (zum Testen + fuer die App) ──
routerAdd("POST", "/api/briefing", function (e) {
  var hh = require(__hooks + "/hh.js");
  var hid = e.auth ? e.auth.get("household") : "";
  if (!hid) return e.json(400, { error: "Kein Haushalt zugeordnet" });
  var text = hh.buildBriefing(hid);
  var body = e.requestInfo().body || {};
  var sent = 0;
  if (body.send) {
    try {
      var links = $app.findRecordsByFilter("telegram_links", "household = '" + hid + "'", "", 100, 0);
      links.forEach(function (l) { hh.tgReply(l.get("chat_id"), text); sent++; });
    } catch (err) {}
  }
  return e.json(200, { ok: true, briefing: text, sentToTelegram: sent });
}, $apis.requireAuth());

// ── Taeglicher Morgen-Briefing-Versand via Telegram (05:00 UTC ~ 07:00 MESZ) ──
cronAdd("morning_briefing", "0 5 * * *", function () {
  try { require(__hooks + "/hh.js").sendTelegramBriefings(); } catch (e) {}
});
