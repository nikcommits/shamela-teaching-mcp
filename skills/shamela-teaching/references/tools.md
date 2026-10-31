# مرجع الأدوات — Tool reference

أسماء الأدوات قد تأتي ببادئة بحسب البرنامج المضيف (مثل `mcp__shamela-teaching__teaching_status`). استعمل ما يظهر في قائمة أدواتك.

| الخطوة | Step | الأداة / Tool | ملاحظة |
|---|---|---|---|
| ١ | Library & projects | `teaching_status` | أول استدعاء في كل جلسة / first call in every session |
| ١ | Health detail | `shamela_health` | تشخيص تفصيلي عند الحاجة |
| ٢ | Create project | `teaching_project_create` | `series` أو `research` |
| ٢ | Resume project | `teaching_project_get` | بلا معرِّف = آخر مشروع |
| ٢ | Settings / glossary | `teaching_project_update` | `glossary_set`, `glossary_remove` |
| ٣ | Find a book | `shamela_resolve`, `shamela_search_books`, `shamela_search_authors` | لا تخمّن المعرِّف |
| ٣ | Not downloaded? | `shamela_suggest_download` | رابط التنزيل |
| ٣ | Choose book | `teaching_book_set` | `base` / `commentary` / `reference` |
| ٣ | Table of contents | `shamela_get_toc` | |
| ٣ | Map a page | `teaching_locate` | الصفحة المطبوعة + الجزء |
| ٤ | Read | `shamela_get_book_section`, `shamela_get_pages_range`, `shamela_get_page` | أكمل الأجزاء المقطوعة |
| ٤ | Search | `shamela_search_pages`, `shamela_search_phrase`, `shamela_search_exact` | النتائج مادة عمل لا اقتباس |
| ٤ | Base text in commentaries | `teaching_parallels` | |
| ٥ | Add verified source | `teaching_source_add` | الطريق الوحيد إلى الاقتباس |
| ٥ | Source folder | `teaching_source_list` | |
| ٥/٨ | Re-check | `teaching_source_recheck` | بعد تحديث المكتبة / قبل النهائي |
| ٥ | Remove source | `teaching_source_remove` | بطلب المستخدم فقط |
| ٦ | Translation context | `teaching_translation_context` | |
| ٦ | Save translation | `teaching_translation_save` | مع `context_sha256` |
| ٦ | Human review | `teaching_translation_review` | بتصريح المستخدم فقط |
| ٦ | Qur'an check | `shamela_get_aya`, `shamela_search_quran` | |
| ٧ | Save unit | `teaching_unit_save` | فقرات موسومة |
| ٧ | Show unit | `teaching_unit_get` | |
| ٨ | Open checks | `teaching_open_checks` | اعرضها كما هي |
| ٩ | Export | `teaching_export` | `markdown` / `html` / `json` |

## حالات التحقق — Verification statuses

| الحالة | المعنى | يجوز الاستشهاد؟ |
|---|---|---|
| `verified` | ثابت بحروفه، بتحققين مستقلين | نعم |
| `verified_normalized` | ثابت؛ المحفوظ لفظ الكتاب بتشكيله (المرسل اختلف في التشكيل/الرسم) | نعم، مع التنبيه |
| `verified_local` | ثابت في الصفحة المجلوبة، ولم يجرِ تحقق المحرك | بتحفظ؛ أعد الفحص |
| `differs` / `partial` | مختلف الألفاظ / ثابت بعضه | لا |
| `not_found` | غير موجود في الصفحة | لا |
| `unverifiable` | تعذّر التحقق (كتاب غير منزَّل، المحرك متوقف) | لا |
