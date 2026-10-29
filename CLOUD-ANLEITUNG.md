# Datei-Cloud einrichten (Supabase)

Die Cloud ist ein gemeinsamer Dateibereich im Tab „Cloud" der Lernwebsite.
Jeder Angemeldete kann Dateien hochladen, ansehen und herunterladen –
**löschen und umbenennen darf nur, wer die Datei selbst hochgeladen hat.**
Diese Regeln werden von Supabase **serverseitig** durchgesetzt (Row Level
Security), nicht nur im Browser.

## Was wurde geändert

| Datei | Änderung |
|---|---|
| `index.html` | Cloud-Tab ersetzt: Anmeldung/Registrierung, Upload mit Fortschrittsanzeige, Dateiliste mit Suche/Filter/Sortierung, PDF- & Bild-Vorschau, Download, Lösch-Dialog. Keine bestehende Funktion wurde verändert. |
| `supabase-config.js` | Neu: öffentliche Projekt-Konfiguration (musst du einmal ausfüllen). |
| `supabase/schema.sql` | Neu: Datenbank-Tabellen, Sicherheitsregeln, Speicher-Bucket, Finalisierungs-Funktion. |
| `tests/cloud.test.mjs` | Neu: Sicherheits- und Funktionstests. |
| `CLOUD-ANLEITUNG.md` | Diese Anleitung. |

Die Dateien `Lernpult – Mathe & Physik2.html` (auch unter `.github/workflows/`)
sind unverändert geblieben.

## Architektur

Die Website bleibt eine statische Seite auf GitHub Pages. Die Cloud nutzt
Supabase als Backend:

- **Auth**: E-Mail + Passwort. Wer den Link zur Website hat, kann sich ein
  eigenes Konto anlegen (offener Zugang, wie besprochen).
- **Datenbank** (`cloud_files`): Dateiliste mit Fach, Kategorie, Größe, Typ,
  Eigentümer und Datum. Lese-Recht für alle Angemeldeten, Lösch-Recht nur
  für den Eigentümer, direktes Einfügen/Ändern ist gesperrt.
- **Finalisierungsfunktion** (`finalize_cloud_upload`): Ein Datenbankeintrag
  entsteht erst, wenn die hochgeladene Datei nachweislich im Speicher liegt
  und die serverseitig ermittelte Größe innerhalb der 30-MB-Grenze ist.
  Gleichzeitig setzt die Funktion einen Finalisierungs-Marker am Speicherobjekt
  – erst danach dürfen andere Nutzer die Datei abrufen. Abgebrochene oder
  unfertige Uploads bleiben für alle außer dem Eigentümer unsichtbar. Die
  Funktion ist wiederholbar: Geht eine Antwort verloren, kann der Aufruf
  einfach erneut erfolgen, ohne einen doppelten Eintrag zu erzeugen.
- **Speicher** (`cloud`-Bucket): privat, 30 MB pro Datei, nur erlaubte Typen
  (PDF, Bilder, Office-Dokumente, ZIP). Jeder Nutzer lädt nur in seinen
  eigenen Ordner; Ansehen und Herunterladen läuft über zeitlich begrenzte,
  signierte URLs – nur für Angemeldete.
- **Live-Updates**: Neue Dateien erscheinen bei allen Nutzern automatisch.

## Einrichtung in 5 Schritten

### 1. Supabase-Projekt anlegen

1. [supabase.com](https://supabase.com) → kostenloses Konto → „New Project".
2. Name z. B. `physik-lk`, Region `Central EU (Frankfurt)`, starkes
   Datenbank-Passwort setzen und gut aufbewahren.
3. Die Kosten und Limits des kostenlosen Tarifs (u. a. Speicherplatz)
   solltest du vorab in der aktuellen Supabase-Preisliste prüfen.

### 2. Datenbank einrichten

Im Dashboard: **SQL Editor** → Inhalt von `supabase/schema.sql` einfügen → **Run**.
Das Skript ist wiederholbar; es werden vorhandene Regeln ersetzt und fehlende
Objekte ergänzt. Trotzdem vorher schauen, was drinsteht.

**Update-Hinweis**: Nach Änderungen an dieser Datei (z. B. kam die
Umbenennen-Funktion `rename_cloud_file` später hinzu) einfach den kompletten
Inhalt erneut ausführen – bestehende Dateien und Konten bleiben erhalten.

### 3. Anmeldung konfigurieren

Im Dashboard: **Authentication → Sign Up / Providers**:
- „Allow new users to sign up" muss an bleiben (offener Zugang per Link).
- „Confirm email" (E-Mail-Bestätigung) nach Geschmack:
  - **Aus**: Registrierung ohne Wartezeit, aber vergessene Passwörter
    lassen sich nur per E-Mail-Reset wiederherstellen, wenn die
    angegebene Adresse wirklich existiert und abrufbar ist.
  - **An**: jeder muss einmal in sein Postfach schauen; dafür ist
    sichergestellt, dass die E-Mail-Adressen echt sind.
- Der Link „Passwort vergessen?" in der Cloud verschickt eine
  Wiederherstellungs-E-Mail – das funktioniert nur mit echten Adressen.

### 4. Konfiguration eintragen

Im Dashboard: **Project Settings → API**. Die **Project URL** und den
**anon public**-Schlüssel in `supabase-config.js` eintragen und committen.

Wichtig: Der anon-Schlüssel ist **kein Geheimnis** und darf im Browser
sichtbar sein – alle Rechte werden serverseitig über Row Level Security
geprüft. Niemals den `service_role`-Schlüssel in die Website einbauen.

### 5. Veröffentlichen und testen

Push auf `main` löst das gewohnte GitHub-Pages-Deployment aus. Danach:
Website öffnen → Tab „Cloud" → Konto anlegen → Anzeigename setzen → Datei
hochladen.

### Sicherheitstests ausführen

```bash
cd tests
npm install
export SUPABASE_URL=https://DEIN-PROJEKT.supabase.co
export SUPABASE_ANON_KEY=DEIN-ANON-KEY
npm test
```

Voraussetzung: „Confirm email" ist deaktiviert (siehe Schritt 3).
Getestet werden u. a.: B sieht und lädt die Datei von A herunter, B kann
sie weder über die Datenbank noch über den Speicher löschen oder
umbenennen, B kann keine Einträge unter fremdem Namen anlegen und die
Finalisierung nicht für fremde Pfade aufrufen, Überschreibversuche werden
abgewiesen, unfinalisierte Uploads sind für B nicht abrufbar, Unangemeldete
erhalten nichts, 31-MB- und `.exe`-Uploads werden abgewiesen, Uploads ohne
echte Datei hinterlassen keinen Eintrag, die Finalisierung ist wiederholbar,
A benennt die eigene Datei um und löscht sie.

## Sicherheit – wie das Eigentümerprinzip durchgesetzt wird

- **Identität** kommt vom Supabase-Login (Server-Sitzung), nicht aus
  clientseitig frei manipulierbaren Angaben.
- **Löschen** (Datenbankeintrag und Speicherobjekt) erlauben die
  Sicherheitsregeln nur für den Eigentümer – ein manipulierter API-Aufruf
  eines fremden Nutzers löscht schlicht 0 Zeilen bzw. wird abgewiesen.
- **Einfügen** ist nur über die serverseitige Funktion möglich, die Pfad,
  Eigentümer-Ordner, Existenz und echte Größe der Datei prüft.
- **Dateitypen und -größe** werden serverseitig geprüft (Bucket-Konfiguration,
  Datenbank-Constraints, Finalisierungsfunktion) – nicht nur im Browser.
- **Speicherpfade** werden aus Nutzer-ID + Zufalls-UUID gebildet; Dateinamen
  werden nur als Anzeige-Metadaten gespeichert und im Browser maskiert
  (kein Path Traversal, kein XSS über Dateinamen).
- **Fehlermeldungen** zeigen nur verständliche Texte, keine internen Pfade.

## Grenzen und offene Punkte

- **Inhaltsprüfung (Magic Bytes) bewusst ausgelassen** (wie besprochen):
  Typ und Größe werden serverseitig geprüft, der tatsächliche Dateiinhalt
  aber nicht bytegenau validiert. Nachrüstbar über eine Supabase Edge
  Function, wenn gewünscht.
- **Verwaiste Speicherobjekte** sind möglich, wenn ein Upload nach dem
  Speichern, aber vor der Finalisierung abbricht (Sitzung weg, Tab zu).
  Sie sind für niemanden außer dem Eigentümer sichtbar; gelegentlich kann
  man sie im Dashboard unter Storage aufräumen.
- **Löschreihenfolge**: Die Oberfläche löscht immer zuerst den
  Datenbankeintrag, dann das Speicherobjekt. Löscht jemand das
  Speicherobjekt direkt über die API, bleibt ein Eintrag ohne Datei
  (Ansehen/Download schlagen dann fehl). Ein solcher Eintrag lässt sich
  als Eigentümer ganz normal löschen.
- **Das bestehende Website-Passwort** bleibt reiner Sichtschutz (wie bisher);
  die Cloud hat ihre eigene, echte Anmeldung.
- **Testkonten**: Der Test legt zwei Konten an; sie bleiben bestehen,
  außer du übergibst `SUPABASE_SERVICE_KEY` (nur lokal verwenden, nie
  committen!).
- E-Mail-Adressen sind für alle angemeldeten Nutzer nicht sichtbar –
  angezeigt werden die selbstgewählten Anzeigenamen.
