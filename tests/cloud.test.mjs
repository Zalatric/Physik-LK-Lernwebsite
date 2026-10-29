// Tests für die Datei-Cloud (Supabase).
//
// Voraussetzungen:
//   1. Supabase-Projekt angelegt und supabase/schema.sql ausgeführt.
//   2. Für die Testkonten: Authentication → Sign Up → „Confirm email" deaktivieren
//      (kann danach wieder aktiviert werden).
//   3. Umgebungsvariablen setzen:
//        export SUPABASE_URL=https://xxxx.supabase.co
//        export SUPABASE_ANON_KEY=eyJ...
//   4. Ausführen:
//        cd tests && npm install && npm test
//
// Optional: SUPABASE_SERVICE_KEY angeben, um die angelegten Testkonten am Ende zu löschen.
//
// Getestete Szenarien (siehe Aufgabenstellung):
//   A lädt hoch · B sieht Datei · B kann herunterladen · B kann nicht löschen
//   (auch nicht per manipuliertem API-Aufruf) · A löscht eigene Datei ·
//   Unangemeldete ohne Zugriff · zu große Dateien und ungültige Typen abgewiesen ·
//   fehlgeschlagene Uploads hinterlassen keine Einträge.

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;
if (!URL || !KEY) {
  console.error('Bitte SUPABASE_URL und SUPABASE_ANON_KEY setzen (siehe Kopf dieser Datei).');
  process.exit(1);
}

const mk = () => createClient(URL, KEY, { realtime: { transport: ws } });

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  ✗ ') + name); };
const rnd = () => Math.random().toString(36).slice(2, 10);

const cA = mk();      // Nutzer A (Eigentümer)
const cB = mk();      // Nutzer B (Angreifender)
const cAnon = mk();   // nicht angemeldet

const mailA = `test-a-${rnd()}@example.com`, mailB = `test-b-${rnd()}@example.com`, pw = 'testpass123';

// --- 1. Konten anlegen (Sitzung erforderlich) ---
let r = await cA.auth.signUp({ email: mailA, password: pw });
if (r.error) { console.error('Konto A konnte nicht angelegt werden: ' + r.error.message); process.exit(1); }
if (!r.data.session) { console.error('Keine Sitzung nach Registrierung – ist „Confirm email" deaktiviert?'); process.exit(1); }
const uidA = r.data.user.id;
r = await cB.auth.signUp({ email: mailB, password: pw });
if (r.error || !r.data.session) { console.error('Konto B konnte nicht angelegt/angemeldet werden: ' + (r.error?.message || 'keine Sitzung')); process.exit(1); }
const uidB = r.data.user.id;
ok('Nutzer A und B können Konten anlegen und sich anmelden', true);

// --- 2. A lädt eine Datei hoch (Speicher + Finalisierung) ---
const pdfBytes = new Blob(['%PDF-1.4\n% Testdatei Physik-LK\n'], { type: 'application/pdf' });
const pathA = `${uidA}/${rnd()}.pdf`;
r = await cA.storage.from('cloud').upload(pathA, pdfBytes, { contentType: 'application/pdf' });
ok('A kann Datei in den Speicher hochladen', !r.error);
r = await cA.rpc('finalize_cloud_upload', {
  p_name: 'Testaufgabe.pdf', p_fach: 'Physik', p_category: 'Aufgaben',
  p_mime: 'application/pdf', p_path: pathA,
});
ok('A kann Upload serverseitig finalisieren (Eintrag entsteht)', !r.error && !!r.data);
const fileId = r.data;

// --- 2b. Finalisierung ist wiederholbar (verlorene Antworten sind unkritisch) ---
r = await cA.rpc('finalize_cloud_upload', {
  p_name: 'Testaufgabe.pdf', p_fach: 'Physik', p_category: 'Aufgaben',
  p_mime: 'application/pdf', p_path: pathA,
});
ok('Erneute Finalisierung desselben Pfads ist idempotent', !r.error && r.data === fileId);

// --- 3. B sieht die Datei von A ---
r = await cB.from('cloud_files').select('*').eq('path', pathA).maybeSingle();
ok('B sieht die Datei von A in der Liste', !!r.data && r.data.owner === uidA);

// --- 4. B kann die Datei herunterladen (signierte URL + echter Abruf) ---
r = await cB.storage.from('cloud').createSignedUrl(pathA, 60);
const res = await fetch(r.data.signedUrl);
const body = await res.text();
ok('B kann signierte URL erzeugen und die Datei tatsächlich abrufen', res.status === 200 && body.includes('%PDF'));

// --- 5. B darf die Datei von A NICHT löschen (Zustandsprüfung, nicht nur Fehler) ---
r = await cB.from('cloud_files').delete({ count: 'exact' }).eq('id', fileId);
const deletedByB = (r.count ?? 0) > 0 || (r.data && r.data.length > 0);
r = await cA.from('cloud_files').select('id').eq('path', pathA).maybeSingle();
ok('B kann fremden Datenbankeintrag nicht löschen (Eintrag existiert noch)', !deletedByB && !!r.data);

r = await cB.storage.from('cloud').remove([pathA]);
r = await cA.storage.from('cloud').createSignedUrl(pathA, 60);
const stillThere = r.error ? false : (await fetch(r.data.signedUrl)).status === 200;
ok('B kann fremdes Speicherobjekt nicht löschen (Datei noch abrufbar)', stillThere);

// --- 6. B kann keinen Eintrag unter fremdem Eigentum anlegen (manipulierter owner) ---
r = await cB.from('cloud_files').insert({
  owner: uidA, name: 'Gefälscht.pdf', fach: 'Physik', category: 'Aufgaben',
  size: 100, mime: 'application/pdf', path: `${uidA}/${rnd()}.pdf`,
});
r = await cB.from('cloud_files').select('id').eq('owner', uidA).eq('name', 'Gefälscht.pdf');
ok('B kann keinen Eintrag unter A-Identität anlegen', r.data.length === 0);

// --- 7. Niemand kann direkt einfügen (auch A nicht – nur der Weg über die Funktion ist offen) ---
r = await cA.from('cloud_files').insert({
  owner: uidA, name: 'Direkt.pdf', fach: 'Physik', category: 'Aufgaben',
  size: 100, mime: 'application/pdf', path: `${uidA}/${rnd()}.pdf`,
});
ok('Direktes Einfügen ist gesperrt (nur finalize_cloud_upload)', !!r.error);

// --- 8. Unangemeldete Nutzer ohne Zugriff ---
r = await cAnon.from('cloud_files').select();
ok('Unangemeldet sieht keine Dateien', !r.error && r.data.length === 0);
r = await cAnon.from('cloud_files').insert({
  owner: uidA, name: 'Anon.pdf', fach: 'Physik', category: 'Aufgaben',
  size: 1, mime: 'application/pdf', path: `${uidA}/x.pdf`,
});
ok('Unangemeldet kann nichts einfügen', !!r.error);
r = await cAnon.storage.from('cloud').createSignedUrl(pathA, 60);
ok('Unangemeldet erhält keine signierte URL', !!r.error);

// --- 9. Zu große Datei (31 MB) wird abgewiesen ---
const big = new Blob([new Uint8Array(31 * 1024 * 1024)]);
r = await cA.storage.from('cloud').upload(`${uidA}/${rnd()}.zip`, big, { contentType: 'application/zip' });
ok('31-MB-Datei wird vom Speicher abgewiesen', !!r.error);

// --- 10. Ungültiger Dateityp wird abgewiesen ---
r = await cA.storage.from('cloud').upload(`${uidA}/${rnd()}.exe`,
  new Blob(['MZ'], { type: 'application/x-msdownload' }), { contentType: 'application/x-msdownload' });
ok('Ungültiger Dateityp (.exe) wird abgewiesen', !!r.error);

// --- 11. B kann nicht in A-Ordner hochladen (Path-Traversal-/Ordnerangriff) ---
r = await cB.storage.from('cloud').upload(`${uidA}/${rnd()}.pdf`, pdfBytes, { contentType: 'application/pdf' });
ok('B kann nicht in A-Ordner hochladen', !!r.error);

// --- 11b. B kann die Finalisierung nicht für A-Pfade aufrufen ---
r = await cB.rpc('finalize_cloud_upload', {
  p_name: 'Angriff.pdf', p_fach: 'Physik', p_category: 'Aufgaben',
  p_mime: 'application/pdf', p_path: pathA,
});
ok('B kann Finalisierung nicht für A-Pfad aufrufen', !!r.error);

// --- 11c. Überschreibversuch: Upload auf As bestehenden Pfad scheitert ---
r = await cA.storage.from('cloud').upload(pathA, new Blob(['%PDF-1.4 gefälscht'], { type: 'application/pdf' }), { contentType: 'application/pdf' });
ok('Überschreiben einer bestehenden Datei wird abgewiesen', !!r.error);

// --- 11d. Unfinalisierte Uploads sind für andere nicht abrufbar ---
const pathPending = `${uidA}/${rnd()}.pdf`;
await cA.storage.from('cloud').upload(pathPending, pdfBytes, { contentType: 'application/pdf' });
r = await cB.storage.from('cloud').createSignedUrl(pathPending, 60);
ok('B erhält keine signierte URL für A-Datei ohne Finalisierung', !!r.error);
r = await cA.storage.from('cloud').remove([pathPending]);
ok('A räumt die unfinalisierte Testdatei auf', !r.error);

// --- 12. Finalisierung ohne existierendes Objekt scheitert (kein Scherbeintrag) ---
r = await cA.rpc('finalize_cloud_upload', {
  p_name: 'Geist.pdf', p_fach: 'Physik', p_category: 'Aufgaben',
  p_mime: 'application/pdf', p_path: `${uidA}/existiert-nicht.pdf`,
});
ok('Finalisierung ohne hochgeladene Datei scheitert', !!r.error);
r = await cA.from('cloud_files').select('id').eq('name', 'Geist.pdf');
ok('Kein Datenbankeintrag ohne echte Datei entstanden', r.data.length === 0);

// --- 12b. Umbenennen: ausschließlich über die RPC-Funktion, nur der Eigentümer ---
r = await cB.rpc('rename_cloud_file', { p_id: fileId, p_name: 'Gehackt.pdf' });
ok('B kann fremde Datei nicht umbenennen (RPC abgewiesen)', !!r.error);
r = await cA.from('cloud_files').select('name').eq('id', fileId).maybeSingle();
ok('Name nach fremdem Umbenennversuch unverändert', r.data && r.data.name === 'Testaufgabe.pdf');
r = await cB.from('cloud_files').update({ name: 'Direkt.png' }).eq('id', fileId);
r = await cA.from('cloud_files').select('name').eq('id', fileId).maybeSingle();
ok('B kann nicht direkt in der Tabelle umbenennen', r.data && r.data.name === 'Testaufgabe.pdf');
r = await cA.rpc('rename_cloud_file', { p_id: fileId, p_name: null });
ok('Fehlender Name wird abgewiesen', !!r.error);
r = await cA.rpc('rename_cloud_file', { p_id: fileId, p_name: 'Umbenannt.pdf' });
ok('Eigentümer-RPC erfolgreich', !r.error);
r = await cA.from('cloud_files').select('name').eq('id', fileId).maybeSingle();
ok('A kann eigene Datei umbenennen', r.data && r.data.name === 'Umbenannt.pdf');
r = await cA.rpc('rename_cloud_file', { p_id: fileId, p_name: '   ' });
ok('Leerer Name wird abgewiesen', !!r.error);
r = await cA.from('cloud_files').select('name').eq('id', fileId).maybeSingle();
ok('Name nach leerem Umbenennversuch unverändert', r.data && r.data.name === 'Umbenannt.pdf');

// --- 13. A löscht die eigene Datei ---
r = await cA.from('cloud_files').delete({ count: 'exact' }).eq('id', fileId);
ok('A kann die eigene Datei löschen', !r.error && (r.count ?? 0) === 1);
r = await cA.storage.from('cloud').remove([pathA]);
ok('A kann das eigene Speicherobjekt löschen', !r.error);
r = await cA.from('cloud_files').select('id').eq('path', pathA).maybeSingle();
ok('Eintrag ist danach weg', !r.data);

// --- Optional: Testkonten aufräumen (benötigt service_role-Schlüssel) ---
if (process.env.SUPABASE_SERVICE_KEY) {
  const admin = createClient(URL, process.env.SUPABASE_SERVICE_KEY, { realtime: { transport: ws } });
  await admin.auth.admin.deleteUser(uidA);
  await admin.auth.admin.deleteUser(uidB);
  console.log('\n(i) Testkonten wurden gelöscht.');
} else {
  console.log(`\n(i) Testkonten bleiben bestehen (Löschung erfordert SUPABASE_SERVICE_KEY):\n    ${mailA}\n    ${mailB}`);
}

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
