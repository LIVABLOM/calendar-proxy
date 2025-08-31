app.get("/api/reservations/:logement", async (req, res) => {
  const logement = req.params.logement.toUpperCase();
  if (!calendars[logement]) {
    return res.status(404).json({ error: "Logement inconnu" });
  }

  try {
    let events = [];
    for (const url of calendars[logement]) {
      const e = await fetchICal(url);

      // Filtrage stricte pour s'assurer que seul le logement demandé est pris
      const filtered = e.filter(ev => {
        const loc = (ev.logement || ev.summary || "").toUpperCase();
        return loc.includes(logement); 
      });

      events = events.concat(filtered);
    }
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
