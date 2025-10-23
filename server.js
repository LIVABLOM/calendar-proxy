// ======================
// Proxy calendrier LIVABLŌM (PostgreSQL)
// ======================

const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical");
const icalGen = require("ical-generator");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ======================
// Config PostgreSQL
// ======================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // nécessaire pour Railway
});

// Test connexion PostgreSQL
pool.connect()
  .then(() => console.log("✅ PostgreSQL connecté !"))
  .catch(err => console.error("❌ Erreur connexion PostgreSQL :", err));


// ======================
// URLs iCal externes
// ======================
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

// ======================
// Fonction fetch iCal externe
// ======================
async function fetchICal(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/calendar, text/plain, */*"
      }
    });

    if (!res.ok) {
      console.error(`❌ Erreur fetch iCal ${url}: HTTP ${res.status}`);
      return [];
    }

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
    console.error("❌ Erreur iCal pour", url, err);
    return [];
  }
}

// ======================
// POST ajouter réservation depuis le site
// ======================
app.post("/api/add-reservation", async (req, res) => {
  const { logement, start, end, title } = req.body;

  if (!logement || !start || !end) {
    return res.status(400).json({ error: "Champs manquants" });
  }

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

// ======================
// GET générer iCal dynamique
// ======================
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) return res.status(404).send("Logement inconnu");

  try {
    let events = [];

    // 1️⃣ Récupérer les événements externes
    for (const url of calendars[logement]) {
      const e = await fetchICal(url);
      events = events.concat(e);
    }

    // 2️⃣ Ajouter les réservations locales depuis PostgreSQL
    const dbRes = await pool.query(
      `SELECT logement, start, "end", title FROM reservations WHERE logement=$1`,
      [logement]
    );
    events = events.concat(dbRes.rows);

    // 3️⃣ Générer le fichier iCal
    const cal = icalGen({
      name: `Calendrier LIVABLŌM - ${logement}`,
      timezone: "Europe/Paris"
    });

    for (const ev of events) {
      cal.createEvent({
        start: new Date(ev.start),
        end: new Date(ev.end),
        summary: ev.title || "Réservé"
      });
    }

    res.setHeader("Content-Type", "text/calendar");
    res.send(cal.toString());
  } catch (err) {
    console.error("❌ Erreur génération iCal:", err);
    res.status(500).send("Erreur serveur");
  }
});

// ======================
// Route test
// ======================
app.get("/", (req, res) =>
  res.send("🚀 Proxy calendrier LIVABLŌM opérationnel avec iCal + PostgreSQL !")
);

// ======================
// Lancement serveur
// ======================
app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
