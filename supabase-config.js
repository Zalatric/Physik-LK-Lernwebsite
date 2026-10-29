/* Konfiguration der Datei-Cloud (Supabase).
   ----------------------------------------------------------------
   Nach dem Anlegen deines Supabase-Projekts (siehe CLOUD-ANLEITUNG.md)
   trägst du hier die Werte aus „Project Settings → API" ein:

   - url:     die Projekt-URL, z. B. https://abcd1234.supabase.co
   - anonKey: der öffentliche „anon public"-Schlüssel

   Diese beiden Werte sind KEINE Geheimnisse: Sie sind dafür gemacht,
   im Browser sichtbar zu sein. Die Rechteverwaltung übernimmt vollständig
   Supabase selbst (Row Level Security, siehe supabase/schema.sql).

   Niemals den „service_role"-Schlüssel hier eintragen! */
window.SUPABASE_CONFIG = {
  url: "",
  anonKey: ""
};
