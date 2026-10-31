# Leitfaden: Übersetzung arabischer Quellentexte ins Deutsche

Gilt, wenn ein Projekt die Übersetzungsebene mit Zielsprache `de` nutzt. Der arabische Text bleibt maßgeblich; die Übersetzung dient dem Verständnis und ersetzt ihn nie.

## 1. Arbeitsablauf (technisch gebunden)

1. `teaching_translation_context` für genau eine Quelle aufrufen.
2. **Nur `source.text_ar` übersetzen.** Seite, Nachbarseiten, Kapitelpfad und Fußnoten sind Kontext: Sie klären Bezüge (wer ist „er“? worauf verweist „dies“?), werden aber nicht mitübersetzt.
3. Mit demselben `context_sha256` über `teaching_translation_save` speichern. Ein anderer oder selbst erzeugter Hash wird abgelehnt — das ist gewollt.
4. Dem Nutzer Original und Übersetzung zusammen zeigen und den Status „maschinell, ungeprüft“ nennen.

## 2. Kontext wirklich nutzen

- **Bezüge auflösen:** Pronomen und Demonstrativa anhand der vorangehenden Seite klären. Bleibt ein Bezug offen, in eckigen Klammern kennzeichnen: „er [d. h. der Imam?]“.
- **Sprecherwechsel:** In Kommentaren wechseln „قال المصنف“ (Grundtext) und „قال الشارح“ / „أقول“ (Kommentator). Wechsel sichtbar halten, z. B. durch „[Grundtext:] … [Kommentar:] …“.
- **Fachgebiet:** `toc_path` und `project.focus` bestimmen die Bedeutung mehrdeutiger Begriffe (z. B. ‎سنة‎ als „Sunna“ vs. „empfohlene Handlung“; ‎حكم‎ als „Urteil“ vs. „Rechtsnorm“ vs. „Weisheit“).
- **Epoche des Autors** (`author_death_hijri`): Begriffe in der Bedeutung ihrer Zeit wiedergeben, nicht in moderner Bedeutung.
- **Fußnoten des Herausgebers** (`page.foot`): Sie können Lesarten oder Belegstellen nennen. Nie in die Übersetzung des Grundtexts einfließen lassen. Ist die Quelle selbst eine Fußnote (`field: foot`), das in der Ausgabe sagen.

## 3. Genauigkeit vor Glätte

- Inhaltlich nichts hinzufügen oder weglassen. Erläuterungen nur in `[ ]`.
- Satzbau darf deutsch werden; Aussage, Modalität („muss“, „soll“, „darf“, „es wird gesagt“) und Gewissheitsgrad müssen erhalten bleiben (‎قيل‎ = „es wurde gesagt“, distanzierend; ‎الصحيح‎ = „das Richtige [nach Ansicht des Autors]“).
- Mehrdeutigkeit nicht verstecken: wahrscheinlichste Lesart übersetzen, Alternative in `[ ]` nennen.
- Zahlen, Namen, Buchtitel exakt; Buchtitel beim ersten Vorkommen in Umschrift, ggf. mit deutscher Wiedergabe in Klammern.

## 4. Glossar ist verbindlich

- Steht ein Begriff im Projektglossar, **genau diese Wiedergabe** verwenden. Der Server prüft das und meldet sonst `GLOSSARY_MISMATCH`.
- Fehlt ein wiederkehrender Fachbegriff im Glossar: dem Nutzer eine Wiedergabe vorschlagen und erst nach Zustimmung mit `teaching_project_update` (`glossary_set`) eintragen.
- Konvention ohne Glossareintrag: beim ersten Vorkommen „deutsche Wiedergabe (Umschrift)“, danach die deutsche Wiedergabe — z. B. „Konsens (iǧmāʿ)“.

## 5. Umschrift nach DMG

| Arabisch | DMG | Arabisch | DMG | Arabisch | DMG |
|---|---|---|---|---|---|
| ء | ʾ | ز | z | ق | q |
| ث | ṯ | س | s | ك | k |
| ج | ǧ | ش | š | و (Konsonant) | w |
| ح | ḥ | ص | ṣ | ي (Konsonant) | y |
| خ | ḫ | ض | ḍ | ة | -a / -at (Status constructus) |
| د | d | ط | ṭ | ا ى (lang) | ā |
| ذ | ḏ | ظ | ẓ | ي (lang) | ī |
| ر | r | ع | ʿ | و (lang) | ū |
| غ | ġ | ف | f | ال | al- (assimiliert: aš-šams) |

Beispiele: ‎حديث‎ ḥadīṯ, ‎فقه‎ fiqh, ‎إجماع‎ iǧmāʿ, ‎قياس‎ qiyās, ‎طهارة‎ ṭahāra, ‎الشافعي‎ aš-Šāfiʿī.

## 6. Koran, Hadith, Formeln

- **Koranverse** im Text als solche kennzeichnen und Sure:Vers angeben (mit `shamela_get_aya` prüfen, nicht aus dem Gedächtnis). Eine bestimmte deutsche Koranübersetzung nur verwenden, wenn der Nutzer sie festgelegt hat; sonst eigene, wörtliche Übersetzung mit Hinweis „[eigene Übersetzung]“.
- **Hadithwortlaut** nicht paraphrasieren; Überlieferungskette (isnād) übersetzen oder als „[Überlieferungskette]“ zusammenfassen — je nach Vorgabe des Nutzers, aber immer gekennzeichnet.
- **Eulogien** (z. B. ‎صلى الله عليه وسلم‎, ‎رضي الله عنه‎, ‎رحمه الله‎) nicht weglassen: ausschreiben („Allah segne ihn und schenke ihm Heil“) oder Glossar-Abkürzung verwenden.

## 7. Zielgruppe

`project.audience` beeinflusst nur Erläuterungen in `[ ]` und die Wortwahl der eigenen Erklärungen im Unterricht — **nie** den übersetzten Inhalt. Für Anfänger lieber mehr Erläuterungen in Klammern als eine vereinfachte Übersetzung.

## 8. Was die Technik prüft — und was nicht

Der Server prüft: Kontext wurde ausgegeben, Quelltext unverändert (Hash), Glossarbegriffe vorhanden. Er prüft **nicht**, ob die Übersetzung inhaltlich richtig ist. Deshalb bleibt jede Übersetzung „maschinell, ungeprüft“, bis eine Person sie mit `teaching_translation_review` freigibt — und dieses Werkzeug wird nur auf ausdrückliche Aussage des Nutzers aufgerufen.
