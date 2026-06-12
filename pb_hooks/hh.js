// ═══════════ Haushalts-Helpy KI-Parser — gemeinsames Modul ═══════════
// Wird von main.pb.js per require() geladen. Platzhalter werden bei der
// Installation per sed ersetzt.

module.exports = {
  CLAUDE_KEY: "__CLAUDE_KEY__",
  TG_TOKEN: "__TG_TOKEN__",
  TG_SECRET: "__TG_SECRET__",
  OPENAI_KEY: "__OPENAI_KEY__",

  // Telegram-Sprachnachricht herunterladen und per Whisper transkribieren
  transcribe: function (fileId) {
    var meta = $http.send({
      url: "https://api.telegram.org/bot" + this.TG_TOKEN + "/getFile?file_id=" + fileId,
      method: "GET", timeout: 30
    });
    if (meta.statusCode !== 200) throw new Error("Telegram getFile " + meta.statusCode);
    var path = meta.json.result.file_path;
    var dl = $http.send({
      url: "https://api.telegram.org/file/bot" + this.TG_TOKEN + "/" + path,
      method: "GET", timeout: 60
    });
    if (dl.statusCode !== 200) throw new Error("Telegram download " + dl.statusCode);
    var form = new FormData();
    form.append("model", "whisper-1");
    form.append("language", "de");
    form.append("file", $filesystem.fileFromBytes(dl.body, "voice.ogg"));
    var res = $http.send({
      url: "https://api.openai.com/v1/audio/transcriptions",
      method: "POST",
      headers: { "Authorization": "Bearer " + this.OPENAI_KEY },
      body: form,
      timeout: 120
    });
    if (res.statusCode !== 200) throw new Error("Whisper " + res.statusCode + ": " + res.raw);
    return (res.json.text || "").trim();
  },

  persons: function () {
    try {
      return $app.findRecordsByFilter("persons", "id != ''", "name", 50, 0).map(function (r) { return r.get("name"); });
    } catch (err) { return []; }
  },

  parse: function (text) {
    var now = new Date();
    var weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    var sys = "Du bist der Eingabe-Parser einer Haushalts-App. Wandle den deutschen Satz des Nutzers in JSON-Aktionen um.\n"
      + "Heute ist " + weekdays[now.getDay()] + ", der " + now.toISOString().slice(0, 10) + ".\n"
      + "Bekannte Personen: " + this.persons().join(", ") + ". Nutze exakt diese Namen. Ist keine Person genannt, lasse person leer.\n\n"
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
      headers: { "x-api-key": this.CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: sys, messages: [{ role: "user", content: text }] }),
      timeout: 60
    });
    if (res.statusCode !== 200) throw new Error("Claude API " + res.statusCode);
    var raw = res.json.content[0].text.trim();
    raw = raw.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    return JSON.parse(raw);
  },

  apply: function (parsed) {
    var n = 0;
    (parsed.actions || []).forEach(function (a) {
      var col = $app.findCollectionByNameOrId(a.collection);
      var rec = new Record(col);
      for (var k in a.data) rec.set(k, a.data[k]);
      $app.save(rec);
      n++;
    });
    return n;
  },

  tgReply: function (chatId, text) {
    $http.send({
      url: "https://api.telegram.org/bot" + this.TG_TOKEN + "/sendMessage",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text }),
      timeout: 30
    });
  }
};
