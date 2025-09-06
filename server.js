const express = require("express");
const fetch = require("node-fetch");
const ical = require("ical");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // clé Stripe dans les variables d'environnement

const app = express();
const PORT = process.env.PORT || 4000;

// Autoriser toutes les requêtes CORS
app.use(cors());
app.use(express.json()); // Pour parser le body JSON

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
async function fetchICal(url, logement) {
  try {
    const res = await fetch(url);
    const data = await res.text();
    const parsed = ical.parseICS(data);

    return Object.values(parsed)
      .filter(ev => ev.start && ev.end)
      .map(ev => ({
        summary: ev.summary || "Réservé",
        start: ev.start,
        end: ev.end,
        logement
      }));
  } catch (err) {
    console.error("Erreur iCal pour", url, err);
    return [];
  }
}

// --- Endpoints Calendrier ---
app.get("/api/reservations/:logement", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) return res.status(404).json({ error: "Logement inconnu" });

  try {
    let events = [];
    for (const url of calendars[logement]) {
      const e = await fetchICal(url, logement);
      events = events.concat(e);
    }
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/reservations", async (req, res) => {
  try {
    let events = [];
    for (const logement of Object.keys(calendars)) {
      for (const url of calendars[logement]) {
        const e = await fetchICal(url, logement);
        events = events.concat(e);
      }
    }
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// --- Endpoint Stripe ---
app.post("/create-checkout-session", async (req, res) => {
  const { price, nights, date, logement } = req.body;

  if (!price || !nights || !date || !logement) {
    return res.status(400).json({ error: "Données manquantes" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: `Réservation ${logement} le ${date}`,
          },
          unit_amount: price * 100,
        },
        quantity: nights,
      }],
      mode: "payment",
      success_url: "https://livablom.fr/success.html",
      cancel_url: "https://livablom.fr/cancel.html",
    });

    res.json({ id: session.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur création session Stripe" });
  }
});

app.listen(PORT, () => console.log(`Server lancé sur le port ${PORT}`));
