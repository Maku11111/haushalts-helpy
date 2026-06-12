// ═══════════ Haushalts-Helpy KI-Parser — Routen ═══════════
// Gemeinsame Logik liegt in hh.js (PocketBase-Handler laufen in
// isolierten VMs, daher require() innerhalb jedes Handlers).

// ── Lebenszeichen (zum Testen der Installation) ──
routerAdd("GET", "/api/hh-ping", function (e) {
  return e.json(200, { ok: true, hooks: "v4" });
});

// ── Endpunkt fuer den Mikrofon-Button der App (nur angemeldete Nutzer) ──
routerAdd("POST", "/api/voice-input", function (e) {
  var hh = require(__hooks + "/hh.js");
  var body = e.requestInfo().body;
  var text = (body.text || "").toString().trim();
  if (!text) return e.json(400, { error: "text fehlt" });
  try {
    var parsed = hh.parse(text);
    var n = hh.apply(parsed);
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
        var parsed = hh.parse(text);
        var n = hh.apply(parsed);
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
