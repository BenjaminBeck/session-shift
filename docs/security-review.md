# Lokaler Sicherheitsreview – 11.11.2026

Dieser lokale Fork basiert auf Upstream `69ce155` (0.1.3). Der Build 0.1.4 ist
für weitere lokale Tests gedacht. **Die Befunde sind nicht vollständig behoben:**
Insbesondere die frühe API-Initialisierung und Teile der nativen Cookie-Semantik
bleiben offen. Die Unterstützung beliebiger Websites bleibt grundsätzlich erhalten;
es gibt keine Beschränkung auf die lokale Testanwendung.

## Korrigierte bzw. verbesserte Punkte

| Punkt | Ergebnis |
| --- | --- |
| npm-Abhängigkeiten | Lockfile aktualisiert, TypeScript als benötigtes Build-Werkzeug deklariert. Abschließender npm-Audit: 0 Schwachstellen. Ausschließlich Entwicklungsabhängigkeiten. |
| Fremde Cookie-Schreibzugriffe | Die von Chrome gelieferte Frame-URL/-Origin ist maßgeblich; eine gefälschte Payload-URL oder Tab-ID bestimmt nicht die Berechtigung. Opaque Frames werden abgewiesen. |
| Fremde Cookie-Löschzugriffe | Strukturierte Löschziele bleiben auf die Domain des sendenden Frames beschränkt; HttpOnly und Secure werden berücksichtigt. |
| Cookie-Attribute | Secure und SameSite bleiben gespeichert. Cross-Site-Subrequests/unsichere Methoden erhalten nur Secure-None-Cookies; sichere Hauptnavigationen zusätzlich Lax. Secure-Headerregeln gelten nur für HTTPS, auch beim ersten Aufruf. Fehlende/ungültige SameSite-Werte gelten als Lax. |
| Erster Reload | Der automatische Reload ignoriert `about:blank`/Extension-Seiten und wartet auf die Cookie-Veröffentlichung. Damit wird eine im Upstream reproduzierte Race Condition zwischen Session-Cookie und CSRF-Token vermieden. |
| Gleichzeitige Regelupdates | Veröffentlichungen werden pro Tab serialisiert. Ein Regel-/Budgetfehler blockiert den Tab einschließlich Hauptnavigation, statt einen unvollständigen Satz zu veröffentlichen. |
| Browserneustart | Dauerhafte Domain-Regeln verhindern für bereits geschützte Hosts den stillen Wechsel zur normalen Chrome-Anmeldung. Ohne aktuelle Zuordnung ist eine ausdrückliche Sitzungsauswahl nötig; POST wird blockiert. |

Die Sitzungsauswahl erscheint auch bei neuen Tabs auf bereits geschützten Hosts.
Bestehende normale Tabs behalten beim erstmaligen Schutz ihre normale Sitzung.
Vererbte Profile können die Auswahl automatisch verlassen, sobald ihre Zuordnung
und Regeln erfolgreich eingerichtet sind. Geschützte Hosts bleiben nach dem
Löschen eines Profils geschützt. Es erfolgt keine unsichere Zuordnung über URL,
Fensterposition oder Tab-Reihenfolge. Build und Dev-Watcher liefern die Auswahlseite
mit aus. Mindestversion: Chrome 145.

## Offene Grenzen und nötige Folgeentscheidung

1. **Früher Zugriff auf gemeinsame Web-APIs:** MAIN-world-Skripte können vor dem
   asynchronen Bootstrap native Storage-/Cookie-/IDB-/Cache-APIs erfassen. Eine
   versuchte synchrone Sperre wurde entfernt, weil sie auch normale Websites durch
   Exceptions beim Laden beschädigen würde. Für eine vollständige Behebung braucht
   es einen kontrollierten Seitenstart oder echte getrennte Browserkontexte; das
   wäre eine Architekturänderung mit Kompatibilitätsfolgen. Der Nutzer hat eine
   Beschränkung auf ausgewählte Testwebsites ausdrücklich abgelehnt.
2. **SameSite nur begrenzt nachgebildet:** DNR-Domainbedingungen und der zuletzt
   beobachtete Tab-Scheme ersetzen nicht den vollständigen nativen Algorithmus.
   Schemewechsel, Redirectketten und gemischte Frame-Vorfahren sind nicht vollständig
   abgesichert. Fetch-`credentials` und partitionierte Cookies werden ebenfalls
   nicht vollständig nachgebildet. Dieser Build ist kein verlässliches Werkzeug
   zur Prüfung nativer SameSite-/CSRF-Schutzmechanismen.
3. **Keine native Browserprofil-Isolation:** HTTP-Cache, Service Worker und andere
   Browserzustände teilen weiter das Chrome-Profil. Ein auf einer bisher nicht
   geschützten Domain geöffnetes vererbtes Tab kann seine erste Anfrage vor der
   Profilzuordnung senden. Die dauerhaften Regeln schützen nur bekannte Hosts,
   solange die Extension aktiviert ist und Websitezugriff besitzt. Der sichtbare
   postMessage-Nonce ist keine Sicherheitsgrenze gegenüber bösartigem Seitencode.
4. **Skalierung:** Es gibt weiterhin ein begrenztes DNR-Regelbudget pro Tab. Bei
   Ausschöpfung wird blockiert. Viele Cookie-Domains/Pfade können deshalb eine
   Website unbenutzbar machen. Eine größere Regel-/Profilarchitektur wäre ein
   eigener Folgepunkt.

Diese Grenzen sind keine Freigabe für vollständige Isolation. Die Voraussetzungen
für das weitere Schließen der Startlücke sind oben dokumentiert; es wurde kein
kompatibilitätsbrechender Ersatz als vermeintlicher Fix eingebaut.

Entscheidungen und Alternativen: [ADR-0001](adr/2026/11/0001-require-explicit-role-after-restart.md)
und [ADR-0002](adr/2026/11/0002-bound-cookie-policy-and-bootstrap.md).

## Prüfung

- TypeScript-Check, Produktionsbuild und Locale-Katalogvalidierung erfolgreich.
- 466 Unit-Tests erfolgreich, darunter neue Tests für Frame-Autorität, fremde
  Löschziele, Secure/SameSite und fehlgeschlagene Regelveröffentlichung sowie den ersten Reload.
- Die beiden zuvor instabilen Login-Abläufe bestanden nach dem Reload-Fix jeweils
  fünf Wiederholungen (10/10). Vorher schlug der Login auch am unveränderten
  Upstream-Code in 3 von 5 Durchläufen fehl.
- Abschließende Browsersuite: **71 bestanden, 1 bereits upstream übersprungener
  Inertia-Test**. Die zwei separat reproduzierten macOS-Sprachtests wurden in
  diesem Abschlusslauf ausdrücklich ausgefiltert; sie sind nicht als bestanden
  gewertet.
- Echte Browsertests mit Chrome for Testing 158.0.8127.18 und Playwright 1.65.0
  in eigenen Testprofilen. Das persönliche Chrome-Profil wurde nicht verändert.
- Neue Browserprüfungen: vollständiges Schließen/Neustarten mit zwei Rollen auf
  derselben URL, keine Zielanfrage vor Auswahl, blockierter POST, getrennte Cookies,
  Cross-Site-POST ohne Strict/Lax und erlaubte sichere Lax-Hauptnavigation.
- Die beiden nativen Sprachtests mit `--lang=de/ar` erhalten in diesem macOS-
  Testbrowser Englisch. Dasselbe Ergebnis wurde mit unverändertem Upstream-Code
  im gleichen Browser reproduziert. Dafür ist eine Umgebung nötig, in der Chrome
  tatsächlich mit der gewünschten UI-Sprache läuft; die Assertions werden nicht
  auf Englisch abgeschwächt.

## Lokale Prüfnachweise

Arbeitsverzeichnis für Logs und Screenshots:
`_agent/session-shift-review/`

- `npm-audit-after.json`: abschließender Registry-Audit.
- `unit.log`, `build.log`: Unit-Tests und Build.
- `e2e-verified.log`: abschließender Browserlauf ohne die separat geprüften nativen Sprachtests.
- `baseline-e2e.log`: identische Sprachprobleme im ursprünglichen Extension-Code.
- `baseline-login.log`, `e2e-reload.log`: Loginvergleich vor/nach dem Reload-Fix.
- `final-results/`: Artefakte der abschließenden Browserprüfung.

## Commits nach Punkt

- `721b3a1`: anfällige Entwicklungsabhängigkeiten aktualisiert.
- `e66a902`: Cookie-Schreibberechtigung aus dem sendenden Frame.
- `639bd2b`: fremde strukturierte Cookie-Löschziele abgewiesen.
- `990cdd1`: Cookie-Attribute und eingeschränkte Cross-Site-Header.
- `dc106f8`: Schutz bekannter Hosts beim Browserneustart.
- `a484be2`: erster Reload wartet auf Cookie-Veröffentlichung.
- `028e38c`: isolierte Browser-Testprofile und Artefaktablage.

Die verbleibenden Grenzen sind ausdrücklich dokumentiert; es gibt keinen Commit,
der eine vollständige Behebung des frühen API-Bootstraps behauptet.
