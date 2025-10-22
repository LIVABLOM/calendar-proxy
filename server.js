// ======================
// Proxy calendrier LIVABLŌM + iCal dynamique
// ======================

const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical");
const ical = require("ical-generator"); // <- nouveau
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());

// URLs iCal pour chaque logement
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

// Fonction pour récupérer et parser un iCal
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
    return Object.values(parsed).filter(ev => ev.start && ev.end).map(ev => ({
      title: ev.summary || "Réservé",
      start: ev.start,
      end: ev.end
    }));
  } catch (err) {
    console.error("Erreur iCal pour", url, err);
    return [];
  }
}

// Endpoint pour récupérer les événements en JSON (comme avant)
app.get("/api/reservations/:logement", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) return res.status(404).json({ error: "Logement inconnu" });

  try {
    let events = [];
    for (const url of calendars[logement]) {
      const e = await fetchICal(url);
      events = events.concat(e);
    }
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ======================
// Nouveau : générer un iCal dynamique pour Airbnb/Booking
// ======================
const ical = require("ical-generator"); // au début du fichier

// ...

app.get("/ical/:logement.ics", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) return res.status(404).send("Logement inconnu");

  try {
    let events = [];
    for (const url of calendars[logement]) {
      const e = await fetchICal(url);
      events = events.concat(e);
    }

    // Création du calendrier iCal
    const cal = ical({ name: `Calendrier ${logement} - LIVABLŌM` });
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


app.get("/", (req, res) => res.send("🚀 Proxy calendrier LIVABLŌM opérationnel !"));

app.listen(PORT, () => console.log(`✅ Proxy calendrier lancé sur le port ${PORT}`));
