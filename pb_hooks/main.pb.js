// ═══════════ Haushalts-Helpy KI-Parser (Voice + Telegram) ═══════════
// Platzhalter __CLAUDE_KEY__ / __TG_TOKEN__ / __TG_SECRET__ werden bei der
// Installation per sed durch die echten Schlüssel ersetzt.
const CLAUDE_KEY = "__CLAUDE_KEY__";
const TG_TOKEN   = "__TG_TOKEN__";
const TG_SECRET  = "__TG_SECRET__";

function hhPersons() {
  try {
    return $app.findRecordsByFilter("persons", "id != ''", "name", 50, 0).map(function(r){ return r.get("name"); });
  } catch (err) { return []; }
}

function hhParse(text) {
  var now = new Date();
  var weekdays = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
  var sys = "Du bist der Eingabe-Parser einer Haushalts-App. Wandle den deutschen Satz des Nutzers in JSON-Aktionen um.\n"
    + "Heute ist " + weekdays[now.getDay()] + ", der " + now.toISOString().slice(0,10) + ".\n"
    + "Bekannte Personen: " + hhPersons().join(", ") + ". Nutze exakt diese Namen. Ist keine Person genannt, lasse person leer.\n\n"
    + "Verfuegbare Collections und Felder:\n"
    + "- calendar: title, date (YYYY-MM-DD HH:MM:SS), date_end, allday (bool), person, note\n"
    + "- todos: text, person, date (YYYY-MM-DD), done=false, recurrence (''|daily|weekly|monthly), priority (''|high|low)\n"
    + "- shopping: name, category (z.B. Obst & Gemuese, Kuehlregal, Backwaren, Haushalt), quantity (Text), person, done=false\n"
    + "- inventory: name, category, quantity (Zahl), min_stock (Zahl)\n"
    + "- invoices: description, amount (Zahl), date, category (Einkauf|Energie|Versicherung|Miete|Mobilitaet|Gesundheit|Freizeit|Sonstiges), status (offen|bezahlt), note\n"
    + "- documents: name, category, expiry_date, person, note\n"
    + "- allowance: person, type (credit|debit|bonus), amount (Zahl), date, description\n\n"
    + "Regeln: Termine ohne Uhrzeit als allday=true anlegen. Relative Datumsangaben (morgen, Donnerstag, naechste Woche) in echte Daten umrechnen. Mehrere Artikel = mehrere Aktionen. Bei Unklarheit die wahrscheinlichste Deutung waehlen.\n"
    + "Antworte AUSSCHLIESSLICH mit kompaktem JSON, ohne Markdown:\n"
    + '{"actions":[{"collection":"...","data":{...}}],"reply":"kurze deutsche Bestaetigung mit Emoji"}';
  var res = $http.send({
    url: "https://api.anthropic.com/v1/messages",
    method: "POST",
    headers: { "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: sys, messages: [{ role: "user", content: text }] }),
    timeout: 60
  });
  if (res.statusCode !== 200) throw new Error("Claude API " + res.statusCode);
  var raw = res.json.content[0].text.trim();
  raw = raw.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  return JSON.parse(raw);
}

function hhApply(parsed) {
  var n = 0;
  (parsed.actions || []).forEach(function(a) {
    var col = $app.findCollectionByNameOrId(a.collection);
    var rec = new Record(col);
    for (var k in a.data) rec.set(k, a.data[k]);
    $app.save(rec);
    n++;
  });
  return n;
}

// ── Lebenszeichen (zum Testen der Installation) ──
routerAdd("GET", "/api/hh-ping", function(e) {
  return e.json(200, { ok: true, hooks: "v2" });
});

// ── Endpunkt fuer den Mikrofon-Button der App (nur angemeldete Nutzer) ──
routerAdd("POST", "/api/voice-input", function(e) {
  var body = e.requestInfo().body;
  var text = (body.text || "").toString().trim();
  if (!text) return e.json(400, { error: "text fehlt" });
  try {
    var parsed = hhParse(text);
    var n = hhApply(parsed);
    return e.json(200, { ok: true, created: n, reply: parsed.reply || ("OK, " + n + " Eintraege angelegt") });
  } catch (err) {
    return e.json(500, { error: "" + err });
  }
}, $apis.requireAuth());

// ── Telegram-Webhook ──
routerAdd("POST", "/api/telegram-webhook", function(e) {
  try {
    var info = e.requestInfo();
    var headers = info.headers || {};
    var secret = headers["x_telegram_bot_api_secret_token"] || headers["X-Telegram-Bot-Api-Secret-Token"] || "";
    if (secret !== TG_SECRET) return e.json(403, { error: "forbidden" });
    var msg = (info.body || {}).message;
    if (!msg) return e.json(200, { skip: true });
    var chatId = msg.chat.id;
    var reply = "";
    if (msg.voice || msg.audio) {
      reply = "🎤 Sprachnachrichten lerne ich gerade noch - bitte schick es mir als Text!";
    } else {
      var text = (msg.text || "").trim();
      if (!text) return e.json(200, { skip: true });
      if (text === "/start") {
        reply = "👋 Hallo! Ich bin Haushalts-Helpy. Schreib mir z.B.:\n- Termin Zahnarzt fuer Maxi am Donnerstag 9:30\n- Milch und Brot auf die Einkaufsliste\n- Neue Aufgabe: Jona raeumt Samstag sein Zimmer auf";
      } else {
        try {
          var parsed = hhParse(text);
          var n = hhApply(parsed);
          reply = parsed.reply || ("OK, " + n + " Eintraege angelegt");
        } catch (perr) {
          reply = "❌ Da ging was schief: " + perr;
        }
      }
    }
    $http.send({
      url: "https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply }),
      timeout: 30
    });
    return e.json(200, { ok: true });
  } catch (err) {
    return e.json(200, { error: "" + err });
  }
});
