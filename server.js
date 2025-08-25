// server.js - Version CommonJS compatible Railway

const express = require('express');
const ical = require('ical-generator');
const fetch = require('node-fetch'); // node-fetch@2
const icalParser = require('node-ical');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Liens ICS depuis .env
const LIVA_ICAL_LINKS = [
  process.env.LIVA_GOOGLE_ICS,
  process.env.LIVA_AIRBNB_ICS,
  process.env.LIVA_BOOKING_ICS
].filter(Boolean);

const BLOM_ICAL_LINKS = [
  process.env.BLOM_GOOGLE_ICS,
  process.env.BLOM_AIRBNB_ICS,
  process.env.BLOM_BOOKING_ICS
].filter(Boolean);

// Fonction pour récupérer et parser un lien ICS avec logs
async function fetchICalEvents(url) {
  try {
    console.log("Récupération ICS :", url);
    const response = await fetch(url);
    console.log("Statut réponse :", response.status);
    if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
    const text = await response.text();
    console.log("Taille du texte récupéré :", text.length);
    const parsed = icalParser.parseICS(text);
    const events = Object.values(parsed).filter(e => e.type === 'VEVENT');
    console.log("Nombre d'événements :", events.length);
    return events;
  } catch (err) {
    console.error('❌ Erreur récupération ICS :', url, err.message);
    return [];
  }
}

// Générer un ICS combiné
async function generateCombinedICS(res, name, links) {
  const cal = ical({ name });

  for (const url of links) {
    const events = await fetchICalEvents(url);
    events.forEach(e => {
      if (e.start && e.end) {
        cal.createEvent({
          start: e.start,
          end: e.end,
          summary: e.summary || 'Réservé',
          description: e.description || '',
          location: e.location || '',
          url: e.url || ''
        });
      }
    });
  }

  res.setHeader('Content-Type', 'text/calendar');
  res.send(cal.toString());
}

// Routes
app.get('/calendar/liva', (req, res) => generateCombinedICS(res, 'LIVA Calendar', LIVA_ICAL_LINKS));
app.get('/calendar/blom', (req, res) => generateCombinedICS(res, 'BLŌM Calendar', BLOM_ICAL_LINKS));

// Page d’accueil
app.get('/', (req, res) => {
  res.send(`
    <h2>✅ Serveur iCal en cours</h2>
    <ul>
      <li><a href="/calendar/liva">Calendrier LIVA</a></li>
      <li><a href="/calendar/blom">Calendrier BLŌM</a></li>
    </ul>
  `);
});

// Lancer le serveur
app.listen(PORT, () => console.log(`🚀 Serveur iCal en écoute sur http://0.0.0.0:${PORT}`));
