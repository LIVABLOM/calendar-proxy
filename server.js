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
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  try {
    const events = await getAllReservations(logement);

    const cal = icalGen({ name: `Calendrier ${logement} - LIVABLŌM` });
    events.forEach(ev => {
      cal.createEvent({
        start: ev.start,
        end: ev.end,
        summary: ev.title
      });
    });

    res.setHeader("Content-Type", "text/calendar");
    res.send(cal.toString());
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

// ----------------------
// POST ajouter réservation depuis le site
// ----------------------
app.post("/api/add-reservation", async (req, res) => {
  const { logement, start, end, title } = req.body;
  if (!logement || !start || !end) return res.status(400).json({ error: "Champs manquants" });

  try {
    const query = `
      INSERT INTO reservations (logement, start, "end", title)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    const values = [logement.toUpperCase(), start, end, title || "Réservé (site LIVABLŌM)"];
    const result = await pool.query(query, values);

    console.log(`✅ Nouvelle réservation ajoutée pour ${logement}: ${start} → ${end}`);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Erreur ajout réservation :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/// ✅ Nouvelle route pour recevoir les réservations depuis livablom-stripe
app.post("/api/add-reservation", async (req, res) => {
  const { logement, date_debut, date_fin, title } = req.body;
  if (!logement || !date_debut || !date_fin)
    return res.status(400).json({ error: "Données manquantes" });

  try {
    await pool.query(
      'INSERT INTO reservations (logement, start, "end", title) VALUES ($1, $2, $3, $4)',
      [logement, date_debut, date_fin, title || "Réservation via Stripe"]
    );
    console.log("✅ Réservation ajoutée depuis Stripe:", logement);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Erreur ajout BDD proxy:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// 🧭 Route de test
app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel !"));

// ✅ Lancement du serveur
app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
