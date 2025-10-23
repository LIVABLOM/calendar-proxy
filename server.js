// ======================
// Proxy calendrier LIVABLŌM (mise à jour 2025-10-23)
// ======================

const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical");
const icalGen = require("ical-generator");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// URLs iCal pour chaque logement (Airbnb + Booking + Google)
const calendars = {
  LIVA: [
    "https://calendar.google.com/calendar/ical/25b3ab9fef930d1760a10e762624b8f604389bdbf69d0ad23c98759fee1b1c89%40group.calendar.google.com/private-13c805a19f362002359c4036bf5234d6/basic.ics",
    "https://www.airbnb.fr/calendar/ical/41095534.ics?s=723d983690200ff422703dc7306303de",
    "https://ical.booking.com/v1/export?t=30a4b8a1-39a3-4dae-9021-0115bdd5e49d"
  ],
  BLOM: [
    "https://calendar.google.com/calendar/ical/c686866e780e72a89dd094dedc492475386f2e6ee8e22b5a63efe7669d52621b%40group.calendar.google.com/private-a78ad751bafd3b6f19cf5874453e6640/basic.ics",
    "https://www.airbnb.fr/calendar/ical/985569147645507170.ics?s=b9199a1a132a6156fcce597fe4786c1e",
    "https://ical.booking.com/v1/export?t=8b652fed-8787-4a0c-974c-eb139f83b20f"
  ]
};

// Fonction pour récupérer et parser un iCal externe
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
// ➕ Ajouter une réservation (depuis ton site)
// ======================
app.post("/api/add-reservation", (req, res) => {
  const { logement, start, end, title } = req.body;

  if (!logement || !start || !end) {
    return res.status(400).json({ error: "Champs manquants" });
  }

  try {
    const filePath = "reservations.json";
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const key = logement.toUpperCase();

    if (!data[key]) data[key] = [];

    data[key].push({
      title: title || "Réservé (site LIVABLŌM)",
      start,
      end
    });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Nouvelle réservation ajoutée pour ${key}: ${start} → ${end}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Erreur ajout réservation :", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// 📅 Génération iCal dynamique (pour Airbnb / Booking)
// ======================
app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) return res.status(404).send("Logement inconnu");

  try {
    let events = [];

    // Récupérer les événements externes (Airbnb, Booking, Google)
    for (const url of calendars[logement]) {
      const e = await fetchICal(url);
      events = events.concat(e);
    }

    // Ajouter les réservations locales (du site)
    const filePath = "reservations.json";
    if (fs.existsSync(filePath)) {
      const localData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const localReservations = localData[logement] || [];
      events = events.concat(localReservations);
    }

    // Générer le fichier iCal
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
// Route de test
// ======================
app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel avec iCal bidirectionnel !"));

// ======================
// Lancement serveur
// ======================
app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
