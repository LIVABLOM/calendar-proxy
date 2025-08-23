// server.js
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Liens iCal publics
const LIVA_ICAL = 'https://calendar.google.com/calendar/ical/.../basic.ics';
const BLOM_ICAL = 'https://calendar.google.com/calendar/ical/.../basic.ics';

// Route LIVA
app.get('/calendar/liva', async (req, res) => {
  try {
    const response = await fetch(LIVA_ICAL);
    const text = await response.text();
    res.set('Content-Type', 'text/calendar');
    res.send(text);
  } catch (err) {
    console.error('Erreur LIVA:', err);
    res.status(500).send('Impossible de récupérer le calendrier LIVA');
  }
});

// Route BLOM
app.get('/calendar/blom', async (req, res) => {
  try {
    const response = await fetch(BLOM_ICAL);
    const text = await response.text();
    res.set('Content-Type', 'text/calendar');
    res.send(text);
  } catch (err) {
    console.error('Erreur BLOM:', err);
    res.status(500).send('Impossible de récupérer le calendrier BLOM');
  }
});

// Route racine
app.get('/', (req, res) => {
  res.send(`
    <h2>Serveur iCal en cours</h2>
    <ul>
      <li><a href="/calendar/liva">Calendrier LIVA</a></li>
      <li><a href="/calendar/blom">Calendrier BLOM</a></li>
    </ul>
  `);
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur iCal en cours sur le port ${PORT}`);
});