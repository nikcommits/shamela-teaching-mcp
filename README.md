# shamela-teaching-mcp

**التحضير الموثَّق للدروس والأبحاث من المكتبة الشاملة ٤** — خادم MCP ومهارة (Skill) مرافقة.
**Quellenbasierte Unterrichtsvorbereitung aus al-Maktaba al-Shamila 4** — MCP-Server und Skill.
**Source-verified lesson preparation from al-Maktaba al-Shamila 4** — MCP server and skill.

[العربية](#العربية) · [Deutsch](#deutsch) · [English](#english) · [Development](#development)

> الحالة: إصدار أولي ٠٫١٫٠. اختُبر آليًّا ببيانات اختبار، ولم يُختبر بعدُ على كل منصة مع تثبيت حقيقي للشاملة — شغِّل [الاختبار الذاتي](#الاختبار-الذاتي) بعد التثبيت.
> Status: first release 0.1.0 — automatically tested with test data; run the [self-test](#selbsttest) against your own Shamela installation after installing.

---

## العربية

### ما هذا؟

أداةٌ لمن يدرِّس من كتب التراث: تختار كتابًا من مكتبتك الشاملة المنزَّلة على جهازك، وتبني منه سلسلة دروس أو بحثًا موضوعيًّا، ويكون **كل نصٍّ منقول ثابتًا في موضعه بتحقُّقٍ تقني** لا بمجرد قول المساعد.

- **ملف المصادر:** لا يصير نصٌّ صالحًا للاستشهاد إلا بعد أن يجلب الخادم صفحته **كاملة** ويتحقق منه **مرتين** (مقارنة مستقلة + أداة التحقق في محرك الشاملة)، ثم يحفظ **لفظ الكتاب نفسه** مع موضع دائم (الكتاب، الصفحة، الجزء، الصفحة المطبوعة، بصمة النص).
- **تعيين الصفحات بلا تخمين:** الصفحة المطبوعة المتكررة في أكثر من جزء تُعرض احتمالاتها ولا يُختار أحدها تلقائيًّا؛ والخلط بين رقم الصفحة المطبوع ومعرِّفها يُكشف.
- **التمييز بين الأنواع:** نص أصلي، ترجمة، تلخيص (يسمِّي مصادره)، شرح المدرّس، نشاط. والنقل غير المميَّز داخل الشرح يُنبَّه إليه.
- **العربية هي الأصل.** الترجمة (مثل الألمانية) طبقة اختيارية: تُربط كل ترجمة بسياقها وبنص المصدر وبمسرد المصطلحات، وتبقى «آلية لم تُراجَع» حتى يراجعها إنسان.
- **تحققات مفتوحة ظاهرة:** ما لم يثبت، أو جُلب ناقصًا، أو تغيّر بعد الحفظ، أو كان من حاشية المحقق، أو مرقَّمًا آليًّا — يظهر في قائمة وفي ملحق كل تصدير.
- **حفظ الحال:** المشاريع والإعدادات تُحفظ في مجلد تختاره، ويُستأنف العمل في الجلسة التالية دون إعادة الإعداد.
- **تصدير:** Markdown وHTML (جاهز للطباعة، من اليمين إلى اليسار) وJSON.

يعتمد على مشروع [shamela-mcp](https://github.com/alhoqbani/shamela-mcp) لحمود الحقباني (رخصة MIT) ويضم أدواته الأربع والثلاثين للبحث والقراءة. لا يكتب في بيانات الشاملة، ولا يحمل أي كتاب.

### المتطلبات

| | |
|---|---|
| النظام | macOS (Apple Silicon أو Intel)، أو Windows 10/11. لينكس غير مختبَر. |
| المكتبة الشاملة | **الإصدار ٤ الحالي** مثبَّتًا، مع تنزيل كتاب واحد على الأقل من داخل التطبيق. |
| المساعد | تطبيق Claude لسطح المكتب (للتثبيت بملف `.mcpb`)، أو أي برنامج يدعم MCP. |
| Node.js | يأتي مع Claude Desktop. للتثبيت من المصدر: Node ٢٠ أو أحدث. |
| جافا | لا حاجة لتثبيتها: تُستعمل جافا المرفقة مع الشاملة. |

### التثبيت

**أ) في Claude Desktop (موصى به)**
1. نزِّل `shamela-teaching-<version>.mcpb` من [صفحة الإصدارات](https://github.com/nikcommits/shamela-teaching-mcp/releases) (أو ابنِه من المصدر، انظر [Development](#development)).
2. Claude Desktop ← الإعدادات ← الإضافات (Extensions) ← الإعدادات المتقدمة ← تثبيت إضافة… ← اختر الملف.
3. في نافذة الإعداد كل الحقول اختيارية:
   - **مجلد المكتبة الشاملة** — يُكتشف تلقائيًّا (macOS: `~/Library/Application Support/Shamela`، Windows: `C:\shamela4` وغيره).
   - **مجلد بيانات التدريس** — الافتراضي: macOS `~/Library/Application Support/shamela-teaching`، Windows `%APPDATA%\shamela-teaching`.
   - **لغة الواجهة** — `ar` (الافتراض) أو `de` أو `en`.
4. أغلق Claude Desktop كليًّا وأعد فتحه، وفعِّل الإضافة في قائمة الأدوات في المحادثة.

> **لا تثبِّت إضافة shamela-mcp الأصلية معها:** هذه الإضافة تضم أدواتها كلها، وتثبيت الاثنتين يكرِّر الأدوات ويشغِّل محركين.

**ب) المهارة (Skill)**
- تطبيقات Claude: الإعدادات ← Capabilities ← Skills ← رفع `shamela-teaching-skill-<version>.zip`.
- Claude Code: انسخ المجلد `skills/shamela-teaching` إلى `~/.claude/skills/`.

**ج) برامج MCP أخرى** — انظر [examples/](examples/).

### الاختبار الذاتي
في محادثة جديدة: «افحص حال المكتبة والمشاريع» (يستدعي `teaching_status`). ومن المصدر:
```bash
npm run build && npm run selftest
```
يختار كتبًا من مكتبتك أنت، ويتحقق من نص، ويرفض نصًّا محرَّفًا، ويعيِّن صفحة مطبوعة، ويتعامل مع كتاب غير منزَّل، ويصدِّر درسًا. لا يكتب في بيانات الشاملة.

### الخصوصية
بيانات الشاملة تُقرأ من جهازك قراءةً فقط، ولا يتصل الخادم بأي خدمة خارجية. وما تجلبه الأدوات من نصوص يدخل في محادثتك مع المساعد ويُعالَج وفق سياسته. بيانات التدريس ملفات JSON في المجلد الذي تختاره.

---

## Deutsch

### Worum geht es?

Ein Werkzeug für Lehrende, die aus klassischen arabischen Werken unterrichten: Man wählt ein Buch aus der **eigenen** Shamela-Bibliothek und baut daraus eine Unterrichtsreihe oder eine thematische Recherche — und **jedes Zitat ist technisch an seiner Fundstelle belegt**, nicht bloß vom Assistenten behauptet.

- **Quellenmappe:** Ein Text wird erst zitierfähig, wenn der Server die Seite **vollständig** abruft, ihn **zweimal unabhängig** prüft (eigener Abgleich + Prüfwerkzeug der Shamela-Suchmaschine) und den **Wortlaut des Buches** mit dauerhaftem Anker speichert (Buch, Seite, Band, Druckseite, Text-Prüfsumme).
- **Seitenzuordnung ohne Raten:** Kommt eine Druckseite in mehreren Bänden vor, werden alle Kandidaten angeboten; Verwechslungen von Druckseite und Seiten-ID werden erkannt.
- **Klare Kennzeichnung:** Originaltext, Übersetzung, Zusammenfassung (mit Quellenangabe), eigene Erklärung, Aufgabe. Unmarkiert übernommener Quellwortlaut wird gemeldet.
- **Arabisch ist die Hauptsprache.** Die deutsche Übersetzung ist eine zuschaltbare Zusatzebene: Jede Übersetzung entsteht mit Kontextpaket (ganze Seite, Nachbarseiten, Kapitelpfad, Fußnoten getrennt, Autor und Epoche, Glossar, Zielgruppe), ist per Prüfsumme an den Originaltext gebunden, wird gegen das Glossar geprüft und bleibt „maschinell, ungeprüft“, bis eine Person sie freigibt. Leitfaden: [translation-de.md](skills/shamela-teaching/references/translation-de.md).
- **Offene Prüfungen sichtbar:** Nicht belegte, unvollständig abgerufene, nachträglich geänderte Stellen, Herausgeber-Fußnoten und automatische Seitenzählung erscheinen als Liste und im Anhang jedes Exports.
- **Arbeitsstand bleibt erhalten:** Projekte und Einstellungen liegen in einem frei wählbaren Ordner; in der nächsten Sitzung geht es ohne erneute Einrichtung weiter.
- **Export:** Markdown, HTML (druckfertig, Arabisch rechts-nach-links), JSON.

Baut auf [shamela-mcp](https://github.com/alhoqbani/shamela-mcp) von Hamoud Alhoqbani (MIT) auf und enthält dessen 34 Such- und Lesewerkzeuge. Schreibt nie in Shamela-Daten und liefert keine Bücher mit.

### Voraussetzungen

| | |
|---|---|
| System | macOS (Apple Silicon oder Intel) oder Windows 10/11. Linux ungetestet. |
| Shamela | **Aktuelle Version 4**, mindestens ein Buch in der App heruntergeladen. |
| Assistent | Claude Desktop (Installation per `.mcpb`) oder ein anderes MCP-fähiges Programm. |
| Node.js | Bringt Claude Desktop mit. Für Installation aus dem Quellcode: Node 20+. |
| Java | Nicht nötig — es wird die Java-Laufzeit verwendet, die Shamela mitliefert. |

### Installation

**A) Claude Desktop (empfohlen)**
1. `shamela-teaching-<version>.mcpb` von den [Releases](https://github.com/nikcommits/shamela-teaching-mcp/releases) laden (oder selbst bauen, siehe [Development](#development)).
2. Claude Desktop → Einstellungen → Erweiterungen → Erweiterte Einstellungen → Erweiterung installieren … → Datei wählen.
3. Alle Felder sind optional:
   - **Shamela-Ordner** — wird automatisch erkannt (macOS: `~/Library/Application Support/Shamela`, Windows: u. a. `C:\shamela4`).
   - **Ordner für Unterrichtsdaten** — Standard: macOS `~/Library/Application Support/shamela-teaching`, Windows `%APPDATA%\shamela-teaching`.
   - **Sprache der Oberfläche** — `ar` (Standard), `de` oder `en`.
4. Claude Desktop ganz beenden, neu öffnen, Erweiterung im Werkzeugmenü des Chats aktivieren.

> **Die ursprüngliche shamela-mcp-Erweiterung nicht zusätzlich installieren:** Diese Erweiterung enthält bereits alle ihre Werkzeuge; beide zusammen würden Werkzeuge doppeln und zwei Suchmaschinen starten.

**B) Skill**
- Claude-Apps: Einstellungen → Capabilities → Skills → `shamela-teaching-skill-<version>.zip` hochladen.
- Claude Code: Ordner `skills/shamela-teaching` nach `~/.claude/skills/` kopieren.

**C) Andere MCP-Programme** — siehe [examples/](examples/).

### Selbsttest
Im Chat: „Prüfe den Stand von Bibliothek und Projekten“ (ruft `teaching_status` auf). Aus dem Quellcode:
```bash
npm run build && npm run selftest
```
Wählt Bücher aus **Ihrer** Bibliothek, belegt ein Zitat, lehnt ein verfälschtes ab, ordnet eine Druckseite zu, meldet ein fehlendes Buch, exportiert eine Einheit. Schreibt nie in Shamela-Daten.

### Datenschutz
Shamela-Daten werden lokal und nur lesend gelesen; der Server selbst verbindet sich mit keinem externen Dienst. Abgerufene Texte werden Teil des Chats mit dem Assistenten und unterliegen dessen Bedingungen. Unterrichtsdaten sind JSON-Dateien im gewählten Ordner.

---

## English

A teaching layer on top of [shamela-mcp](https://github.com/alhoqbani/shamela-mcp): projects (book-based lesson series or thematic research) that persist between sessions; a **source folder** in which every passage is fetched completely, checked twice (own comparison + the engine's `shamela_verify_quote`) and stored in the book's own wording with a permanent anchor; printed-page resolution that never guesses across volumes; an optional translation layer bound to context bundles, source-text hashes and a glossary, with human review; labelled lesson units (original / translation / summary / own explanation / task) with detection of unmarked quotations; visible open checks; Markdown/HTML/JSON export. Arabic is the primary language; German and English interfaces are available. Install as above (`.mcpb` for Claude Desktop; skill as zip or folder). Requirements: macOS or Windows, current Shamela 4 with at least one downloaded book.

### Tools

| Tool | Purpose |
|---|---|
| `teaching_status` | Library state, data folder, saved projects — first call of every session |
| `teaching_project_create` / `_get` / `_update` | Projects, settings, glossary |
| `teaching_book_set` | Base text, commentaries, references (+ volumes, TOC, download hint) |
| `teaching_locate` | Page id ⇄ printed page (+ volume), never guessed |
| `teaching_parallels` | Base-text passage inside the chosen commentaries |
| `teaching_source_add` / `_list` / `_recheck` / `_remove` | Verified source folder |
| `teaching_translation_context` / `_save` / `_review` | Optional translation layer |
| `teaching_unit_save` / `_get` | Labelled lesson units / research results |
| `teaching_open_checks` | What is not (yet) verified |
| `teaching_export` | Markdown, HTML, JSON |
| `shamela_*` (34) | Upstream search, reading, citation, Qur'an, tafsir, hadith tools |

### Configuration (any MCP host)

| Variable | Meaning | Default |
|---|---|---|
| `SHAMELA_INSTALL_ROOT` | Shamela 4 folder | auto-detected |
| `TEACHING_DATA_DIR` | teaching data | per-user app-data folder |
| `TEACHING_LANG` | `ar` · `de` · `en` | `ar` |
| `SHAMELA_JRE` | Java runtime | Shamela's bundled Java |
| `SHAMELA_HELPER_JAR` | search helper jar | `helper/shamela-helper.jar` next to the program |
| `SHAMELA_READY_TIMEOUT_MS` | first-start timeout (slow machines) | 20000 |

---

## Development

```bash
git clone https://github.com/nikcommits/shamela-teaching-mcp.git
cd shamela-teaching-mcp
npm install            # pins alhoqbani/shamela-mcp at a fixed commit
npm test               # unit + contract tests, no Shamela needed
npm run build          # fetches + verifies the helper jar, bundles dist/index.js
npm run selftest       # acceptance test against YOUR Shamela install
npm run pack:mcpb      # → shamela-teaching-<version>.mcpb
npm run pack:skill     # → shamela-teaching-skill-<version>.zip
npm run check:versions
```

- Architecture and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Stored data format and migration policy: [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md)
- Versioning of the tool interface: [docs/VERSIONING.md](docs/VERSIONING.md)
- Changes: [CHANGELOG.md](CHANGELOG.md)

Tests use synthetic book data written for the tests (three book structures and a missing book). No Shamela content belongs in this repository or in automated tests.

## License

MIT — see [LICENSE](LICENSE). Includes [shamela-mcp](https://github.com/alhoqbani/shamela-mcp) (MIT, © Hamoud Alhoqbani) and other open-source components listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Al-Maktaba al-Shamila and its contents are not part of this project; use them under their own terms.
