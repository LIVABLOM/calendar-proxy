import express from 'express';
import ical from 'ical-generator';
import fetch from 'node-fetch';
import icalParser from 'node-ical';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Liens ICS depuis .env
const LIVA_ICAL_LINKS = [
  process.env.LIVA_GOOGLE_ICS,
  process.env.LIVA_AIRBNB_ICS,
  process.env.LIVA_BOOKING_ICS
];

const BLOM_ICAL_LINKS = [
  process.env.BLOM_GOOGLE_ICS,
  process.env.BLOM_AIRBNB_ICS,
  process.env.BLOM_BOOKING_ICS
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

app.get('/', (req, res) => {
  res.send(`
    <h2>Serveur iCal en cours</h2>
    <ul>
      <li><a href="/calendar/liva">Calendrier LIVA</a></li>
      <li><a href="/calendar/blom">Calendrier BLŌM</a></li>
    </ul>
  `);
});

app.listen(PORT, () => console.log(`✅ Serveur iCal en cours sur le port ${PORT}`));
