// server.js
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;


// 🔹 Liens iCal publics
const LIVA_ICAL = 'https://calendar.google.com/calendar/ical/25b3ab9fef930d1760a10e762624b8f604389bdbf69d0ad23c98759fee1b1c89%40group.calendar.google.com/public/basic.ics';
const BLOM_ICAL = 'https://calendar.google.com/calendar/ical/c686866e780e72a89dd094dedc492475386f2e6ee8e22b5a63efe7669d52621b%40group.calendar.google.com/public/basic.ics'; // Remplace TON_CALENDAR_BLOM_PUBLIC par ton vrai lien public

// Route LIVA
app.get('/calendar/liva', async (req, res) => {
    try {
        console.log('Tentative de récupération du calendrier LIVA');
        const response = await fetch(LIVA_ICAL);
        const text = await response.text();
        res.set('Content-Type', 'text/calendar');
        res.send(text);
    } catch (err) {
        console.error('❌ ERREUR LIVA:', err);
        res.status(500).send('Impossible de récupérer le calendrier LIVA');
    }
});

// Route BLOM
app.get('/calendar/blom', async (req, res) => {
    try {
        console.log('Tentative de récupération du calendrier BLOM');
        const response = await fetch(BLOM_ICAL);
        const text = await response.text();
        res.set('Content-Type', 'text/calendar');
        res.send(text);
    } catch (err) {
        console.error('❌ ERREUR BLOM:', err);
        res.status(500).send('Impossible de récupérer le calendrier BLOM');
    }
});

// Route racine pour tester rapidement
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
    console.log(`✅ Serveur iCal en cours sur http://localhost:${PORT}`);
});
