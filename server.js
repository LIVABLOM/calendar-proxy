// server.js
import express from 'express';
import ical from 'ical-generator';
import fetch from 'node-fetch';
import icalParser from 'node-ical';

const app = express();
const PORT = process.env.PORT || 4000;

// Liens ICS pour LIVA
const LIVA_ICAL_LINKS = [
  'https://calendar.google.com/calendar/ical/25b3ab9fef930d1760a10e762624b8f604389bdbf69d0ad23c98759fee1b1c89%40group.calendar.google.com/private-13c805a19f362002359c4036bf5234d6/basic.ics',
  'https://www.airbnb.fr/calendar/ical/41095534.ics?s=723d983690200ff422703dc7306303de',
  'https://ical.booking.com/v1/export?t=30a4b8a1-39a3-4dae-9021-0115bdd5e49d'
];

// Liens ICS pour BLŌM
const BLOM_ICAL_LINKS = [
  'https://calendar.google.com/calendar/ical/c686866e780e72a89dd094dedc492475386f2e6ee8e22b5a63efe7669d52621b%40group.calendar.google.com/private-a78ad751bafd3b6f19cf5874453e6640/basic.ics',
  'https://www.airbnb.fr/calendar/ical/985569147645507170.ics?s=b9199a1a132a6156fcce597fe4786c1e',
  'https://ical.booking.com/v1/export?t=8b652fed-8787-4a0c-974c-eb139f83b20f'
];

// Fonction pour récupérer et parser un lien ICS
async function fetchICalEvents(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    const parsed = icalParser.parseICS(text);
    return Object.values(parsed).filter(event => event.type === 'VEVENT');
  } catch (err) {
    console.error('Erreur récupération ICS :', url, err);
    return [];
  }
}

// Générer un ICS combiné
async function generateCombinedICS(res, name, links) {
  const cal = ical({ name });
  for (const url of links) {
    const events = await fetchICalEvents(url);
    events.forEach(e => {
      cal.createEvent({
        start: e.start,
        end: e.end,
        summary: e.summary,
        description: e.description,
        location: e.location,
        url: e.url
      });
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
    <h2>Serveur iCal en cours</h2>
    <ul>
      <li><a href="/calendar/liva">Calendrier LIVA</a></li>
      <li><a href="/calendar/blom">Calendrier BLŌM</a></li>
    </ul>
  `);
});

// Démarrage du serveur
app.listen(PORT, () => console.log(`✅ Serveur iCal en cours sur le port ${PORT}`));
