// ======================
// Proxy calendrier LIVABLŌM + iCal dynamique + PostgreSQL
// ======================

const express = require("express");
const fetch = require("node-fetch");
const icalGen = require("ical-generator"); // pas de .default
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ type: "application/json; charset=utf-8" }));

const PORT = process.env.PORT || 4000;

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
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/calendar, text/plain, */*"
      }
    });
    if (!res.ok) return [];
    const data = await res.text();
    const parsed = require("ical").parseICS(data);
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
      'SELECT id, title, start, "end" FROM reservations WHERE logement = $1 ORDER BY start ASC',
      [logement.toUpperCase()]
    );
    return res.rows.map(r => ({
      id: r.id,
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
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  try {
    const result = await pool.query(
      'SELECT id, title, start, "end" FROM reservations WHERE logement = $1 ORDER BY start ASC',
      [logement]
    );

    console.log("📄 Réservations pour ICS :", result.rows);

    const cal = icalGen({
      name: `Calendrier ${logement} - LIVABLŌM`,
      timezone: "Europe/Paris",
      prodId: { company: "LIVABLŌM", product: "CalendarProxy" },
    });

    result.rows.forEach(r => {
  cal.createEvent({
    start: new Date(r.start),
    end: new Date(new Date(r.end).getTime() + 24*60*60*1000), // +1 jour pour que fin soit exclusive
    summary: r.title || `Réservé ${logement}`,
    description: `Réservation ${logement}`,
    uid: `livablom-${r.id}@calendar-proxy`,
  });
});


    console.log("🗓️ Événements ICS générés :", cal.events().length);

    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.send(cal.toString());
  } catch (err) {
    console.error("❌ Erreur génération iCal:", err);
    res.status(500).send("Erreur serveur");
  }
});

// ----------------------
// Route pour ajouter une réservation
// ----------------------
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

function parseDateInput(input, defaultHour = 0, defaultMinute = 0) {
  if (input instanceof Date && !isNaN(input)) return input;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [Y, M, D] = input.split("-").map(Number);
    return new Date(Y, M - 1, D, defaultHour, defaultMinute, 0);
  }
  const d = new Date(input);
  if (!isNaN(d)) return d;
  const now = new Date();
  now.setHours(defaultHour, defaultMinute, 0, 0);
  return now;
}

app.post("/api/add-reservation", async (req, res) => {
  console.log("📩 Requête reçue :", req.body);

  const logementRaw = req.body.logement;
  const rawStart = req.body.start || req.body.date_debut;
  const rawEnd = req.body.end || req.body.date_fin;
  const title = req.body.title || "Réservation via Stripe / Site";

  if (!logementRaw || !rawStart || !rawEnd) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  try {
    const logement = String(logementRaw).toUpperCase();
    const startDate = parseDateInput(rawStart, 0, 0);
    const endDate = parseDateInput(rawEnd, 23, 59);

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
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Erreur ajout BDD proxy:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ----------------------
// Route de test
// ----------------------
app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel !"));

// ----------------------
// Lancement serveur
// ----------------------
app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
