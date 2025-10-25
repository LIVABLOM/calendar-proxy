// ======================
// Proxy calendrier LIVABLŌM + iCal dynamique + PostgreSQL
// ======================

const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical");           // parser des iCal externes
const icalGen = require("ical-generator").default; // générer iCal dynamique
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
app.use(express.json()); // indispensable pour parser le JSON envoyé par livablom-stripe

const PORT = process.env.PORT || 4000;

// ✅ Middleware
app.use(cors());
app.use(express.json({ type: "application/json; charset=utf-8" }));

// ----------------------
// PostgreSQL
// ----------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL connecté !"))
  .catch(err => console.error("❌ Erreur connexion PostgreSQL :", err));

// ----------------------
// URLs iCal pour chaque logement
// ----------------------
const calendars = {
  LIVA: [
    process.env.LIVA_GOOGLE_ICS,
    process.env.LIVA_AIRBNB_ICS,
    process.env.LIVA_BOOKING_ICS
  ],
  BLOM: [
    process.env.BLOM_GOOGLE_ICS,
    process.env.BLOM_AIRBNB_ICS,
    process.env.BLOM_BOOKING_ICS
  ]
};

// ----------------------
// Fonction pour récupérer et parser un iCal externe
// ----------------------
async function fetchICal(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
        "Accept": "text/calendar, text/plain, */*"
      }
    });
    if (!res.ok) return [];
    const data = await res.text();
    const parsed = ical.parseICS(data);
    return Object.values(parsed)
      .filter(ev => ev.start && ev.end)
      .map(ev => ({
        title: ev.summary || "Réservé",
        start: ev.start,
        end: ev.end
      }));
  } catch (err) {
    console.error("Erreur iCal pour", url, err);
    return [];
  }
}

// ----------------------
// Récupérer les réservations internes depuis PostgreSQL
// ----------------------
async function fetchInternalReservations(logement) {
  try {
    const res = await pool.query(
      'SELECT title, start, "end" FROM reservations WHERE logement = $1',
      [logement.toUpperCase()]
    );
    return res.rows.map(r => ({
      title: r.title,
      start: new Date(r.start),
      end: new Date(r.end)
    }));
  } catch (err) {
    console.error("Erreur fetch reservations internes :", err);
    return [];
  }
}

// ----------------------
// Fusionner toutes les réservations pour un logement
// ----------------------
async function getAllReservations(logement) {
  if (!calendars[logement]) return [];
  let events = [];
  for (const url of calendars[logement]) {
    const ext = await fetchICal(url);
    events = events.concat(ext);
  }
  const internal = await fetchInternalReservations(logement);
  events = events.concat(internal);
  return events;
}

// ----------------------
// Endpoint JSON
// ----------------------
app.get("/api/reservations/:logement", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  try {
    const events = await getAllReservations(logement);
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ----------------------
// Endpoint pour générer iCal dynamique (.ics)
// ----------------------
// ✅ Génération dynamique du calendrier .ics
// ----------------------
// Endpoint pour générer iCal dynamique (.ics)
// ----------------------
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();

  try {
    // On récupère toutes les réservations internes dans la base
    const result = await pool.query(
      'SELECT id, logement, start, "end", title FROM reservations WHERE logement = $1 ORDER BY start ASC',
      [logement]
    );
    console.log("Réservations pour ICS :", result.rows);


    // Création du calendrier iCal
    const cal = icalGen({
      name: `Calendrier ${logement} - LIVABLŌM`,
      timezone: "Europe/Paris",
      prodId: { company: "LIVABLŌM", product: "CalendarProxy" },
    });

    // Ajout des événements depuis la base
    result.rows.forEach(r => {
      cal.createEvent({
        start: new Date(r.start),
        end: new Date(r.end),
        summary: r.title || `Réservé ${logement}`,
        description: `Réservation ${logement}`,
        uid: `livablom-${r.id}@calendar-proxy`,
      });
    });

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.send(cal.toString());
  } catch (err) {
    console.error("❌ Erreur génération iCal:", err);
    res.status(500).send("Erreur serveur");
  }
});



// ✅ Route unique pour recevoir les réservations (Stripe ou site)
// Utilitaire : formate une date en 'YYYY-MM-DD HH:MM:SS'
function formatPGTimestamp(d) {
  const pad = n => String(n).padStart(2, "0");
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}

// Utilitaire : construit un Date à partir d'une entrée (ISO date, date-only, etc.)
function parseDateInput(input, defaultHour = 0, defaultMinute = 0) {
  // si input déjà Date
  if (input instanceof Date && !isNaN(input)) return input;
  // si format YYYY-MM-DD (date-only)
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [Y, M, D] = input.split("-").map(Number);
    return new Date(Y, M - 1, D, defaultHour, defaultMinute, 0);
  }
  // sinon essaie new Date(input) pour ISO ou autre
  const d = new Date(input);
  if (!isNaN(d)) return d;
  // fallback : today with defaultHour
  const now = new Date();
  now.setHours(defaultHour, defaultMinute, 0, 0);
  return now;
}

// Route fusionnée et robuste
app.post("/api/add-reservation", async (req, res) => {
  console.log("📩 Requête reçue sur /api/add-reservation");
  console.log("🧠 Corps reçu :", req.body);

  const logementRaw = req.body.logement;
  const rawStart = req.body.start || req.body.date_debut;
  const rawEnd = req.body.end || req.body.date_fin;
  const title = req.body.title || "Réservation via Stripe / Site";

  if (!logementRaw || !rawStart || !rawEnd) {
    console.warn("⚠️ Données manquantes :", req.body);
    return res.status(400).json({ error: "Données manquantes" });
  }

  try {
    const logement = String(logementRaw).toUpperCase();

    // Si rawStart/rawEnd sont date-only (YYYY-MM-DD) on met heures par défaut
    // Arrivée 15:00, départ 10:00
    const startDate = parseDateInput(rawStart, 0, 0);   // 00:00
    const endDate = parseDateInput(rawEnd, 23, 59);     // 23:59


    const startTime = formatPGTimestamp(startDate);
    const endTime = formatPGTimestamp(endDate);

    const query = `
      INSERT INTO reservations (logement, start, "end", title)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    const values = [logement, startTime, endTime, title];
    const result = await pool.query(query, values);

    console.log(`✅ Réservation ajoutée pour ${logement}: ${startTime} → ${endTime}`);
    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Erreur ajout BDD proxy:", err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});



// 🧭 Route de test
app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel !"));

// ✅ Lancement du serveur
app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
