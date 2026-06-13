// ═══════════ Haushalts-Helpy KI-Parser — gemeinsames Modul ═══════════
// Wird von main.pb.js per require() geladen. Platzhalter werden bei der
// Installation per sed ersetzt.

module.exports = {
  CLAUDE_KEY: "__CLAUDE_KEY__",
  TG_TOKEN: "__TG_TOKEN__",
  TG_SECRET: "__TG_SECRET__",
  OPENAI_KEY: "__OPENAI_KEY__",
  // Interim: in welchen Haushalt der Telegram-Bot schreibt, bis pro-Familie-Verknuepfung (Phase 6) steht.
  DEFAULT_HOUSEHOLD: "ibfskr2fu9siez7",

  // Authentifizierten Nutzer per Einladungscode einem Haushalt zuordnen
  linkUserToCode: function (userId, code) {
    var h;
    try { h = $app.findFirstRecordByData("households", "invite_code", (code || "").toString().trim().toUpperCase()); }
    catch (e) { throw new Error("Einladungscode ungueltig"); }
    if (!h) throw new Error("Einladungscode ungueltig");
    var u = $app.findRecordById("users", userId);
    u.set("household", h.id);
    if (!u.get("role")) u.set("role", "parent");
    $app.save(u);
    return { householdId: h.id, householdName: h.get("name") };
  },

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

  // Schlagzeilen zu einem Stichwort via Google-News-RSS (kostenlos, kein Key)
  fetchNews: function (keyword, max) {
    max = max || 3;
    var url = "https://news.google.com/rss/search?q=" + encodeURIComponent(keyword) + "&hl=de&gl=DE&ceid=DE:de";
    var res;
    try { res = $http.send({ url: url, method: "GET", timeout: 20 }); } catch (e) { return []; }
    if (res.statusCode !== 200) return [];
    var xml = res.raw || "";
    var items = [], re = /<item>([\s\S]*?)<\/item>/g, m;
    function clean(s) { return (s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim(); }
    while ((m = re.exec(xml)) !== null && items.length < max) {
      var b = m[1];
      var t = clean((b.match(/<title>([\s\S]*?)<\/title>/) || [, ""])[1]);
      var l = clean((b.match(/<link>([\s\S]*?)<\/link>/) || [, ""])[1]);
      var s = clean((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [, ""])[1]);
      if (t) items.push({ title: t, link: l, source: s, topic: keyword });
    }
    return items;
  },

  persons: function (householdId) {
    try {
      var filter = householdId ? ("household = '" + householdId + "'") : "id != ''";
      return $app.findRecordsByFilter("persons", filter, "name", 50, 0).map(function (r) { return r.get("name"); });
    } catch (err) { return []; }
  },

  parse: function (text, householdId) {
    var now = new Date();
    var weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    var sys = "Du bist der Eingabe-Parser einer Haushalts-App. Wandle den deutschen Satz des Nutzers in JSON-Aktionen um.\n"
      + "Heute ist " + weekdays[now.getDay()] + ", der " + now.toISOString().slice(0, 10) + ".\n"
      + "Bekannte Personen: " + this.persons(householdId).join(", ") + ". Nutze exakt diese Namen. Ist keine Person genannt, lasse person leer.\n\n"
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

  // ── Helpy-Tools (Stufe 1): Lese-/Handlungswerkzeuge fuer den Chat ──
  CHAT_FIELDS: {
    calendar:  ["id", "title", "date", "date_end", "allday", "person", "note"],
    todos:     ["id", "text", "person", "date", "done", "recurrence", "priority"],
    shopping:  ["id", "name", "category", "quantity", "person", "done"],
    inventory: ["id", "name", "category", "quantity", "min_stock", "location"],
    invoices:  ["id", "description", "amount", "date", "category", "status", "note"],
    documents: ["id", "name", "category", "expiry_date", "person", "note"],
    allowance: ["id", "person", "type", "amount", "date", "description"],
    persons:   ["id", "name", "emoji", "color", "birthday", "email", "notes"],
    locations: ["id", "room", "shelf", "spot", "shelves"]
  },
  recToObj: function (col, rec) {
    var fs = this.CHAT_FIELDS[col] || ["id"];
    var o = {};
    fs.forEach(function (f) { try { o[f] = rec.get(f); } catch (e) {} });
    return o;
  },
  runTool: function (name, input, hid) {
    var self = this;
    var readable = ["calendar", "todos", "shopping", "inventory", "invoices", "documents", "allowance", "persons", "locations"];
    var writable = ["calendar", "todos", "shopping", "inventory", "invoices", "documents", "allowance", "persons"];
    var col = input ? input.collection : "";
    if (name === "list_records") {
      if (readable.indexOf(col) < 0) return { error: "Unbekannte Sammlung" };
      var limit = Math.min((input.limit || 50), 100);
      var recs = $app.findRecordsByFilter(col, "household = '" + hid + "'", "", limit, 0);
      return { count: recs.length, records: recs.map(function (r) { return self.recToObj(col, r); }) };
    }
    if (name === "create_record") {
      if (writable.indexOf(col) < 0) return { error: "Hier darf ich nichts anlegen" };
      var c = $app.findCollectionByNameOrId(col);
      var rec = new Record(c);
      var d = input.data || {};
      for (var k in d) rec.set(k, d[k]);
      rec.set("household", hid);
      $app.save(rec);
      return { ok: true, id: rec.id };
    }
    if (name === "update_record") {
      if (writable.indexOf(col) < 0) return { error: "Nicht erlaubt" };
      var rec2 = $app.findRecordById(col, input.id);
      if (rec2.get("household") !== hid) return { error: "Gehoert nicht zu deinem Haushalt" };
      var d2 = input.data || {};
      for (var k2 in d2) rec2.set(k2, d2[k2]);
      $app.save(rec2);
      return { ok: true };
    }
    if (name === "delete_record") {
      if (writable.indexOf(col) < 0) return { error: "Nicht erlaubt" };
      var rec3 = $app.findRecordById(col, input.id);
      if (rec3.get("household") !== hid) return { error: "Gehoert nicht zu deinem Haushalt" };
      $app.delete(rec3);
      return { ok: true };
    }
    return { error: "Unbekanntes Werkzeug" };
  },

  // Helpy-Chat (Stufe 1): unterhalten + Daten LESEN und HANDELN via Tool-Use
  chat: function (messages, householdId) {
    var self = this;
    var now = new Date();
    var weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
    var readable = ["calendar", "todos", "shopping", "inventory", "invoices", "documents", "allowance", "persons", "locations"];
    var writable = ["calendar", "todos", "shopping", "inventory", "invoices", "documents", "allowance", "persons"];
    var sys = "Du bist \"Helpy\", der herzliche Familien-Haushalts-Assistent der App Haushalts-Helpy. Du sprichst Deutsch in lockerer du-Form, freundlich, knapp und konkret, Emojis sparsam.\n"
      + "Heute ist " + weekdays[now.getDay()] + ", der " + now.toISOString().slice(0, 10) + ".\n"
      + "Bekannte Personen: " + this.persons(householdId).join(", ") + ". Nutze exakt diese Namen.\n\n"
      + "Du hast WERKZEUGE, um die echten Familiendaten zu lesen und zu aendern:\n"
      + "- list_records(collection, limit): zum Beantworten von Fragen ueber bestehende Daten IMMER zuerst die passende Sammlung lesen (niemals raten!).\n"
      + "- create_record(collection, data): neuen Eintrag anlegen.\n"
      + "- update_record(collection, id, data): Eintrag aendern (z.B. Aufgabe abhaken -> data {done:true}; Termin verschieben -> data {date:\"2026-..\"}). Hol die id vorher per list_records.\n"
      + "- delete_record(collection, id): Eintrag loeschen (nur wenn klar gewuenscht).\n\n"
      + "Sammlungen & Felder:\n"
      + "- calendar: title, date (YYYY-MM-DD HH:MM:SS), date_end, allday(bool), person, note\n"
      + "- todos: text, person, date (YYYY-MM-DD), done(bool), recurrence(''|daily|weekly|monthly), priority(''|high|low)\n"
      + "- shopping: name, category, quantity(Text), person, done(bool)\n"
      + "- inventory: name, category, quantity(Zahl), min_stock(Zahl)\n"
      + "- invoices: description, amount(Zahl), date, category, status(offen|bezahlt), note\n"
      + "- documents: name, category, expiry_date, person, note\n"
      + "- allowance: person, type(credit|debit|bonus), amount(Zahl), date, description\n"
      + "- persons: name, emoji, birthday, email, notes (lesen/aktualisieren)\n"
      + "- locations: room, shelf, spot (nur lesen)\n\n"
      + "Regeln: relative Datumsangaben in echte Daten umrechnen; Termine ohne Uhrzeit allday=true. Werkzeuge sparsam und gezielt nutzen. Antworte am Ende immer kurz und natuerlich auf Deutsch und fasse zusammen, was du gefunden/getan hast.";
    var tools = [
      { name: "list_records",   description: "Liest aktuelle Eintraege einer Sammlung des Haushalts (zum Beantworten von Fragen).", input_schema: { type: "object", properties: { collection: { type: "string", enum: readable }, limit: { type: "integer" } }, required: ["collection"] } },
      { name: "create_record",  description: "Legt einen neuen Eintrag an.", input_schema: { type: "object", properties: { collection: { type: "string", enum: writable }, data: { type: "object" } }, required: ["collection", "data"] } },
      { name: "update_record",  description: "Aendert einen bestehenden Eintrag.", input_schema: { type: "object", properties: { collection: { type: "string", enum: writable }, id: { type: "string" }, data: { type: "object" } }, required: ["collection", "id", "data"] } },
      { name: "delete_record",  description: "Loescht einen Eintrag.", input_schema: { type: "object", properties: { collection: { type: "string", enum: writable }, id: { type: "string" } }, required: ["collection", "id"] } }
    ];
    var working = (messages || []).slice();
    var reply = "", changes = 0;
    for (var iter = 0; iter < 6; iter++) {
      var res = $http.send({
        url: "https://api.anthropic.com/v1/messages",
        method: "POST",
        headers: { "x-api-key": this.CLAUDE_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1500, system: sys, tools: tools, messages: working }),
        timeout: 60
      });
      if (res.statusCode !== 200) throw new Error("Claude API " + res.statusCode);
      var data = res.json;
      var content = data.content || [];
      var toolUses = [], textParts = [];
      content.forEach(function (c) { if (c.type === "text") textParts.push(c.text); else if (c.type === "tool_use") toolUses.push(c); });
      if (data.stop_reason === "tool_use" && toolUses.length) {
        working.push({ role: "assistant", content: content });
        var results = toolUses.map(function (tu) {
          var out;
          try { out = self.runTool(tu.name, tu.input, householdId); } catch (e) { out = { error: "" + e }; }
          if ((tu.name === "create_record" || tu.name === "update_record" || tu.name === "delete_record") && out && out.error === undefined) changes++;
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) };
        });
        working.push({ role: "user", content: results });
        continue;
      }
      reply = textParts.join("\n").trim();
      break;
    }
    return { reply: reply || "Okay!", changes: changes };
  },

  apply: function (parsed, householdId) {
    var n = 0;
    (parsed.actions || []).forEach(function (a) {
      var col = $app.findCollectionByNameOrId(a.collection);
      var rec = new Record(col);
      for (var k in a.data) rec.set(k, a.data[k]);
      if (householdId) rec.set("household", householdId);
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
  },

  // ── Stufe 2: Telegram-Verknuepfung pro Familie ──
  householdForChat: function (chatId) {
    try { var r = $app.findFirstRecordByData("telegram_links", "chat_id", "" + chatId); return r ? r.get("household") : ""; }
    catch (e) { return ""; }
  },
  linkChatToCode: function (chatId, code, name) {
    var h;
    try { h = $app.findFirstRecordByData("households", "invite_code", (code || "").toString().trim().toUpperCase()); }
    catch (e) { throw new Error("Code ungueltig"); }
    if (!h) throw new Error("Code ungueltig");
    var link = null;
    try { link = $app.findFirstRecordByData("telegram_links", "chat_id", "" + chatId); } catch (e) { link = null; }
    if (!link) { link = new Record($app.findCollectionByNameOrId("telegram_links")); link.set("chat_id", "" + chatId); }
    link.set("household", h.id);
    if (name) link.set("name", name);
    $app.save(link);
    return { householdName: h.get("name") };
  },

  // ── Stufe 2: Morgen-Briefing ──
  buildBriefing: function (hid) {
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    function fdate(d) { return ("0" + d.getDate()).slice(-2) + "." + ("0" + (d.getMonth() + 1)).slice(-2) + "."; }
    var out = [];
    try {
      var cals = $app.findRecordsByFilter("calendar", "household = '" + hid + "'", "date", 300, 0);
      var todays = cals.filter(function (c) { return ("" + (c.get("date") || "")).slice(0, 10) === todayStr; });
      if (todays.length) out.push("📅 Heute:\n" + todays.map(function (c) { var d = "" + c.get("date"); var t = c.get("allday") ? "" : (" " + d.slice(11, 16)); return "• " + c.get("title") + t + (c.get("person") ? " (" + c.get("person") + ")" : ""); }).join("\n"));
    } catch (e) {}
    try {
      var todos = $app.findRecordsByFilter("todos", "household = '" + hid + "' && done = false", "", 300, 0);
      var overdue = [], due = [];
      todos.forEach(function (t) { var ds = ("" + (t.get("date") || "")).slice(0, 10); if (ds && ds < todayStr) overdue.push(t); else if (ds === todayStr) due.push(t); });
      if (overdue.length) out.push("⚠️ Überfällig:\n" + overdue.map(function (t) { return "• " + t.get("text") + (t.get("person") ? " (" + t.get("person") + ")" : ""); }).join("\n"));
      if (due.length) out.push("✅ Heute fällig:\n" + due.map(function (t) { return "• " + t.get("text") + (t.get("person") ? " (" + t.get("person") + ")" : ""); }).join("\n"));
    } catch (e) {}
    try {
      var inv = $app.findRecordsByFilter("inventory", "household = '" + hid + "'", "", 400, 0);
      var low = inv.filter(function (i) { return (i.get("quantity") || 0) <= (i.get("min_stock") || 0); });
      if (low.length) out.push("📦 Knapp:\n" + low.map(function (i) { return "• " + i.get("name") + " (" + i.get("quantity") + "/" + i.get("min_stock") + ")"; }).join("\n"));
    } catch (e) {}
    try {
      var docs = $app.findRecordsByFilter("documents", "household = '" + hid + "'", "", 200, 0);
      var exp = docs.filter(function (d) { var ed = d.get("expiry_date"); if (!ed) return false; var days = Math.round((new Date(ed) - now) / 86400000); return days >= 0 && days <= 14; });
      if (exp.length) out.push("📄 Läuft bald ab:\n" + exp.map(function (d) { var days = Math.round((new Date(d.get("expiry_date")) - now) / 86400000); return "• " + d.get("name") + " (in " + days + " T.)"; }).join("\n"));
    } catch (e) {}
    try {
      var pers = $app.findRecordsByFilter("persons", "household = '" + hid + "'", "", 100, 0);
      var bd = [];
      pers.forEach(function (p) { var b = p.get("birthday"); if (!b) return; var x = new Date(b); var t = new Date(now.getFullYear(), x.getMonth(), x.getDate()); var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (t < t0) t.setFullYear(t.getFullYear() + 1); var days = Math.round((t - t0) / 86400000); if (days <= 7) bd.push("• " + p.get("name") + (days === 0 ? " 🎉 HEUTE!" : " (in " + days + " T.)")); });
      if (bd.length) out.push("🎂 Geburtstage:\n" + bd.join("\n"));
    } catch (e) {}
    var header = "☀️ Guten Morgen! Dein Helpy-Briefing für " + fdate(now) + "\n";
    if (!out.length) return header + "\nHeute ist alles entspannt – nichts Dringendes. 😌";
    return header + "\n" + out.join("\n\n");
  },
  sendTelegramBriefings: function () {
    var self = this;
    var links;
    try { links = $app.findRecordsByFilter("telegram_links", "chat_id != ''", "", 500, 0); } catch (e) { return; }
    var cache = {};
    links.forEach(function (l) {
      var hid = l.get("household");
      if (!hid) return;
      if (!cache[hid]) cache[hid] = self.buildBriefing(hid);
      self.tgReply(l.get("chat_id"), cache[hid]);
    });
  }
};
