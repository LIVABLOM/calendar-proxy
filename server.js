// ======================
// Proxy calendrier LIVABLŌM + iCal dynamique + PostgreSQL
// Clean, stable & ready
// ======================

const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical"); // parser iCal externes (lecture)
const icalGen = require("ical-generator"); // génération iCal (écriture)
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json()); // parse JSON body

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
// Helpers : normalisation (supprime accents + uppercase)
// ----------------------
function normalizeLogementName(s) {
  if (!s) return "";
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

// ----------------------
// URLs iCal pour chaque logement (depuis .env)
// ----------------------
const calendars = {
  LIVA: [
    process.env.LIVA_GOOGLE_ICS,
    process.env.LIVA_AIRBNB_ICS,
    process.env.LIVA_BOOKING_ICS
  ].filter(Boolean),
  BLOM: [
    process.env.BLOM_GOOGLE_ICS,
    process.env.BLOM_AIRBNB_ICS,
    process.env.BLOM_BOOKING_ICS
  ].filter(Boolean)
};

// ----------------------
// Fonction pour récupérer et parser un iCal externe (Airbnb/Booking/Google)
// ----------------------
async function fetchICal(url) {
  if (!url) return [];
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/calendar, text/plain, */*"
      },
      // disable node-fetch caching options if any
    });

    if (!res.ok) {
      console.warn(`⚠️ fetchICal: ${url} returned ${res.status}`);
      return [];
    }

    const data = await res.text();
    const parsed = ical.parseICS(data);

    // parsed contains objects with start/end as Date
    return Object.values(parsed)
      .filter(ev => ev && ev.start && ev.end)
      .map(ev => ({
        title: (ev.summary || "Réservé").toString(),
        start: ev.start,
        end: ev.end
      }));
  } catch (err) {
    console.error("❌ Erreur fetchICal pour", url, err);
    return [];
  }
}

// ----------------------
// Récupérer les réservations internes depuis PostgreSQL
// ----------------------
async function fetchInternalReservations(logement) {
  try {
    const normalized = normalizeLogementName(logement);
    const res = await pool.query(
      'SELECT id, title, start, "end" FROM reservations WHERE logement = $1 ORDER BY start ASC',
      [normalized]
    );
    // return array of events with Date objects
    return res.rows.map(r => ({
      id: r.id,
      title: r.title,
      start: new Date(r.start),
      end: new Date(r.end)
    }));
  } catch (err) {
    console.error("❌ Erreur fetch reservations internes :", err);
    return [];
  }
}

// ----------------------
// Fusionner toutes les réservations pour un logement
// ----------------------
async function getAllReservations(logement) {
  const key = normalizeLogementName(logement);
  if (!calendars[key] || calendars[key].length === 0) {
    // Even if no external calendars, still return internal reservations
    return await fetchInternalReservations(key);
  }

  let events = [];
  // fetch external calendars in parallel
  const promises = calendars[key].map(url => fetchICal(url));
  const externalArrays = await Promise.all(promises);
  externalArrays.forEach(arr => { events = events.concat(arr); });

  // internal from DB
  const internal = await fetchInternalReservations(key);
  events = events.concat(internal);

  // normalize: ensure start/end are Date objects
  events = events.map(ev => ({
    title: ev.title || "Réservé",
    start: ev.start instanceof Date ? ev.start : new Date(ev.start),
    end: ev.end instanceof Date ? ev.end : new Date(ev.end)
  }));

  return events;
}

// ----------------------
// Endpoint JSON - retourne la liste d'événements (no-cache)
// ----------------------
app.get("/api/reservations/:logement", async (req, res) => {
  const logement = req.params.logement;
  try {
    const events = await getAllReservations(logement);
    // Force no-cache
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    // return ISO strings for JSON (easier for front)
    const payload = events.map(ev => ({
      title: ev.title,
      start: new Date(ev.start).toISOString(),
      end: new Date(ev.end).toISOString()
    }));
    res.json(payload);
  } catch (err) {
    console.error("❌ /api/reservations error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ----------------------
// Endpoint pour générer iCal dynamique (.ics) - utilisable par Airbnb/Booking
// ----------------------
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement;
  try {
    const events = await getAllReservations(logement);

    // create calendar
    const cal = icalGen({
      name: `Calendrier ${normalizeLogementName(logement)} - LIVABLŌM`,
      timezone: "Europe/Paris",
      prodId: { company: "LIVABLŌM", product: "CalendarProxy" }
    });

    // add events with UID and timezone-aware dates
    events.forEach((r, idx) => {
      cal.createEvent({
        start: new Date(r.start),
        end: new Date(r.end),
        summary: r.title || `Réservé ${normalizeLogementName(logement)}`,
        description: r.title || `Réservation ${normalizeLogementName(logement)}`,
        uid: `livablom-${normalizeLogementName(logement)}-${r.id || idx}@calendar-proxy`,
      });
    });

    // headers
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.send(cal.toString());
  } catch (err) {
    console.error("❌ Erreur génération iCal:", err);
    res.status(500).send("Erreur serveur");
  }
});

// ----------------------
// Route pour recevoir les réservations (Stripe ou site)
// ----------------------
app.post("/api/add-reservation", async (req, res) => {
  console.log("📩 Requête reçue sur /api/add-reservation");
  console.log("🧠 Corps reçu :", req.body);

  // accepte start/end ou date_debut/date_fin
  const logementRaw = req.body.logement;
  const rawStart = req.body.start || req.body.date_debut;
  const rawEnd = req.body.end || req.body.date_fin;
  const title = req.body.title || "Réservation via Stripe / Site";

  if (!logementRaw || !rawStart || !rawEnd) {
    console.warn("⚠️ Données manquantes :", req.body);
    return res.status(400).json({ error: "Données manquantes" });
  }

  try {
    const logement = normalizeLogementName(logementRaw);

    // Si input fournit seulement une date (YYYY-MM-DD), on ajoute heures par défaut
    // Arrivée 15:00, départ 10:00 (comme tu voulais)
    function parseInputToDate(input, defaultHour, defaultMinute) {
      if (input instanceof Date && !isNaN(input)) return input;
      if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        const [Y, M, D] = input.split("-").map(Number);
        return new Date(Y, M - 1, D, defaultHour, defaultMinute, 0);
      }
      const d = new Date(input);
      if (!isNaN(d)) return d;
      // fallback: today with default hour
      const now = new Date();
      now.setHours(defaultHour, defaultMinute, 0, 0);
      return now;
    }

    const startDate = parseInputToDate(rawStart, 15, 0);
    const endDate = parseInputToDate(rawEnd, 10, 0);

    // format postgres-friendly 'YYYY-MM-DD HH:MM:SS'
    function formatPG(d) {
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const startTime = formatPG(startDate);
    const endTime = formatPG(endDate);

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
// Test route & listen
// ----------------------
app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel !"));

app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
