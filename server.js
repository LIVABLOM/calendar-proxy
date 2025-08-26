import express from "express";
import fetch from "node-fetch";
import ical from "ical";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Liens iCal
const icalLinks = [
  { title: "GOOGLE_LIVA", url: "https://calendar.google.com/calendar/ical/25b3ab9fef930d1760a10e762624b8f604389bdbf69d0ad23c98759fee1b1c89%40group.calendar.google.com/private-13c805a19f362002359c4036bf5234d6/basic.ics" },
  { title: "GOOGLE_BLOM", url: "https://calendar.google.com/calendar/ical/c686866e780e72a89dd094dedc492475386f2e6ee8e22b5a63efe7669d52621b%40group.calendar.google.com/private-a78ad751bafd3b6f19cf5874453e6640/basic.ics" },
  { title: "AIRBNB_LIVA", url: "https://www.airbnb.fr/calendar/ical/41095534.ics?s=723d983690200ff422703dc7306303de" },
  { title: "AIRBNB_BLOM", url: "https://www.airbnb.fr/calendar/ical/985569147645507170.ics?s=b9199a1a132a6156fcce597fe4786c1e" },
  { title: "BOOKING_LIVA", url: "https://ical.booking.com/v1/export?t=30a4b8a1-39a3-4dae-9021-0115bdd5e49d" },
  { title: "BOOKING_BLOM", url: "https://ical.booking.com/v1/export?t=8b652fed-8787-4a0c-974c-eb139f83b20f" }
];

let cachedEvents = [];

// Fonction pour récupérer et parser un iCal
async function fetchICal(link) {
  try {
    const res = await fetch(link.url);
    const text = await res.text();
    const data = ical.parseICS(text);

    const events = Object.values(data)
      .filter(e => e.type === "VEVENT")
      .map(e => ({
        title: e.summary || "Bloqué",
        start: e.start,
        end: e.end,
        allDay: true,
        source: link.title
      }));

    return events;
  } catch (err) {
    console.error(`Erreur pour ${link.title}:`, err);
    return [];
  }
}

// Fonction pour mettre à jour tous les événements
async function refreshEvents() {
  try {
    const promises = icalLinks.map(fetchICal);
    const results = await Promise.all(promises);
    cachedEvents = results.flat();
    console.log(`Calendriers mis à jour : ${new Date().toLocaleString()}`);
  } catch (err) {
    console.error("Erreur lors de la mise à jour des calendriers :", err);
  }
}

// Rafraîchissement toutes les 10 minutes
refreshEvents(); // première récupération
setInterval(refreshEvents, 10 * 60 * 1000); // toutes les 10 minutes

// Endpoint API pour retourner les événements
app.get("/api/calendar", (req, res) => {
  res.json(cachedEvents);
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
