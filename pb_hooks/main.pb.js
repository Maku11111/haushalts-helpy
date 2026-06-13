// ═══════════ Haushalts-Helpy KI-Parser — Routen ═══════════
// Gemeinsame Logik liegt in hh.js (PocketBase-Handler laufen in
// isolierten VMs, daher require() innerhalb jedes Handlers).

// ── Lebenszeichen (zum Testen der Installation) ──
routerAdd("GET", "/api/hh-ping", function (e) {
  return e.json(200, { ok: true, hooks: "v8" });
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
    if (text === "/start") {
      reply = "👋 Hallo! Ich bin Haushalts-Helpy. Schick mir Text oder eine Sprachnachricht, z.B.:\n- Termin Zahnarzt fuer Maxi am Donnerstag 9:30\n- Milch und Brot auf die Einkaufsliste\n- Neue Aufgabe: Jona raeumt Samstag sein Zimmer auf";
    } else {
      try {
        var parsed = hh.parse(text, hh.DEFAULT_HOUSEHOLD);
        var n = hh.apply(parsed, hh.DEFAULT_HOUSEHOLD);
        reply = prefix + (parsed.reply || ("OK, " + n + " Eintraege angelegt"));
      } catch (perr) {
        reply = "❌ Da ging was schief: " + perr;
      }
    }
    hh.tgReply(chatId, reply);
    return e.json(200, { ok: true });
  } catch (err) {
    return e.json(200, { error: "" + err });
  }
});
