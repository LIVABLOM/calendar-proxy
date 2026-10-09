'use strict';
const express = require('express');
const fetch = require('node-fetch');
const ical = require('ical');
const icalGen = require('ical-generator').default;
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();
const app = express();
app.use(cors()); app.use(express.json({ limit: '16kb' }));
app.use((req,res,next)=>{res.set('Cache-Control','no-store'); next();});
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});const names = ['LIVA','BLOM'];
function normalize(s){return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();}
function housing(s){const n=normalize(s); if(!names.includes(n)) throw Object.assign(new Error('Logement inconnu'),{status:400}); return n;}
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Object.assign(new Error('Date invalide'),{status:400});return s;}
function range(s,e){s=date(s);e=date(e);if(s>=e)throw Object.assign(new Error('Période invalide'),{status:400}); return [s,e];}
function day(d){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(d));}
function eventDay(d){return d.dateOnly ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : day(d);}
function overlaps(a,b){return a.start<b.end&&a.end>b.start;}
const sources = Object.fromEntries(
  names.map(logement => {
    const configuredSources = ["AIRBNB", "BOOKING"];

    // Google est utilisé seulement si sa variable existe.
    if (process.env[`${logement}_GOOGLE_ICS`]?.trim()) {
      configuredSources.push("GOOGLE");
    }

    return [
      logement,
      configuredSources.map(source => ({
        source,
        url: process.env[`${logement}_${source}_ICS`]
      }))
    ];
  })
);const ready=pool.query(`
CREATE TABLE IF NOT EXISTS calendar_sync_snapshots (
 logement TEXT NOT NULL, source TEXT NOT NULL, events JSONB NOT NULL,
 fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(logement,source));
CREATE TABLE IF NOT EXISTS calendar_booking_holds (
 id UUID PRIMARY KEY, logement TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending', stripe_session_id TEXT UNIQUE,
 reservation_id INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS stripe_session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS reservations_stripe_session_unique ON reservations(stripe_session_id);
`);
ready.catch(()=>console.error('Initialisation calendrier impossible'));
function auth(req,res,next){const actual=Buffer.from(String(req.headers['x-calendar-token']||''));const expected=Buffer.from(process.env.CALENDAR_API_TOKEN||'');if(!expected.length||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return res.status(401).json({error:'Non autorisé'});next();}
async function external(n,{strict=false}={}){
 let failed=false;const result=await Promise.all(sources[n].map(async({source,url})=>{
  try{
   if(!url)throw new Error('Source non configurée');
   const response=await fetch(url,{timeout:12000,size:5*1024*1024,headers:{'User-Agent':'LIVABLOM Calendar','Accept':'text/calendar','Cache-Control':'no-cache'}});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const body=await response.text();if(!body.includes('BEGIN:VCALENDAR')||!body.includes('END:VCALENDAR'))throw new Error('Contenu iCal invalide');
   const parsed=Object.values(ical.parseICS(body));
   const events=parsed.filter(e=>e.type==='VEVENT'&&e.status!=='CANCELLED').map(e=>{
    if(!e.start||!e.end||!Number.isFinite(+e.start)||!Number.isFinite(+e.end))throw new Error('Événement incomplet');
    if(e.rrule)throw new Error('Récurrence non prise en charge : vérifier la source');
    const start=eventDay(e.start),end=eventDay(e.end);if(end<=start)throw new Error('Événement non interprétable comme nuitée');
    return {id:`${source}-${e.uid||crypto.createHash('sha256').update(start+end+String(e.summary)).digest('hex')}`,title:'Réservé',start,end};
   });
   await pool.query(`INSERT INTO calendar_sync_snapshots(logement,source,events) VALUES($1,$2,$3::jsonb) ON CONFLICT(logement,source) DO UPDATE SET events=EXCLUDED.events,fetched_at=NOW()`,[n,source,JSON.stringify(events)]);
   console.log(JSON.stringify({action:'ical_import',logement:n,source,ok:true,count:events.length,time:new Date().toISOString()}));return events;
  }catch(err){
   failed=true;console.warn(JSON.stringify({action:'ical_import',logement:n,source,ok:false,reason:err.message,time:new Date().toISOString()}));
   // Conserve les dernières dates occupées ; aucune autorisation de vente sur cet import.
   const previous=await pool.query('SELECT events FROM calendar_sync_snapshots WHERE logement=$1 AND source=$2',[n,source]);return previous.rows[0]?.events||[];
  }
 }));
 if(failed)throw Object.assign(new Error('Disponibilités temporairement impossibles à vérifier'),{status:503});
 return result.flat();
}
async function internal(n,db=pool){
 const reservations=await db.query(`SELECT id,start::date::text AS start_day,"end"::date::text AS end_day FROM reservations WHERE logement=$1`,[n]);
 const holds=await db.query(`SELECT id,start_date::text,end_date::text FROM calendar_booking_holds WHERE logement=$1 AND state='pending'`,[n]);
 return reservations.rows.map(r=>({id:`reservation-${r.id}`,title:'Réservé',start:r.start_day,end:r.end_day})).concat(holds.rows.map(r=>({id:`hold-${r.id}`,title:'Réservé',start:r.start_date,end:r.end_date})));
}
async function all(n){await ready;return (await external(n)).concat(await internal(n));}
function fail(res,e){console.error('Calendrier:',e.message);return res.status(e.status||503).json({error:e.status===409?'dates_unavailable':'availability_unavailable',message:e.message});}
app.get('/api/reservations/:logement',async(req,res)=>{try{res.json(await all(housing(req.params.logement)));}catch(e){fail(res,e);}});
app.get('/ical/:logement.ics',async(req,res)=>{try{
 const n=housing(req.params.logement),events=await all(n),cal=icalGen({name:`Calendrier ${n} - LIVABLŌM`});
 const seen=new Set();for(const e of events){const key=e.start+'/'+e.end;if(seen.has(key))continue;seen.add(key);cal.createEvent({id:`livablom-${n}-${crypto.createHash('sha256').update(key).digest('hex')}@calendar-proxy`,start:new Date(e.start+'T00:00:00Z'),end:new Date(e.end+'T00:00:00Z'),allDay:true,summary:'Réservé'});}
 res.type('text/calendar').send(cal.toString());
}catch(e){fail(res,e);}});
// Le verrou en base protège aussi contre deux requêtes sur plusieurs instances Railway.
app.post('/api/holds',auth,async(req,res)=>{
 let db;try{
  await ready;const n=housing(req.body.logement),[start,end]=range(req.body.startDate,req.body.endDate);
  const externalEvents=await external(n,{strict:true});
  db=await pool.connect();await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['livablom:'+n]);
  const events=externalEvents.concat(await internal(n,db));
  if(events.some(e=>overlaps({start,end},e)))throw Object.assign(new Error('La période sélectionnée est déjà réservée'),{status:409});
  const id=crypto.randomUUID();await db.query('INSERT INTO calendar_booking_holds(id,logement,start_date,end_date) VALUES($1,$2,$3,$4)',[id,n,start,end]);await db.query('COMMIT');res.json({id});
 }catch(e){if(db)await db.query('ROLLBACK');fail(res,e);}finally{db?.release();}
});
app.post('/api/holds/:id/attach',auth,async(req,res)=>{try{await ready;const r=await pool.query(`UPDATE calendar_booking_holds SET stripe_session_id=$2 WHERE id=$1 AND state='pending' AND (stripe_session_id IS NULL OR stripe_session_id=$2) RETURNING id`,[req.params.id,req.body.sessionId]);if(!r.rowCount)throw new Error('Blocage introuvable');res.json({success:true});}catch(e){fail(res,e);}});
// Libération seulement sur webhook Stripe signé d'expiration/échec, jamais selon l'horloge locale.
app.post('/api/holds/:id/release',auth,async(req,res)=>{try{await ready;await pool.query(`UPDATE calendar_booking_holds SET state='released' WHERE id=$1 AND state='pending' AND (stripe_session_id IS NULL OR stripe_session_id=$2)`,[req.params.id,req.body.sessionId]);res.json({success:true});}catch(e){fail(res,e);}});
app.post('/api/add-reservation',auth,async(req,res)=>{
 let db;try{
  await ready;const n=housing(req.body.logement),[start,end]=range(req.body.date_debut,req.body.date_fin),sessionId=req.body.sessionId;
  if(typeof sessionId!=='string'||!sessionId.startsWith('cs_'))throw Object.assign(new Error('Session Stripe requise'),{status:400});
  db=await pool.connect();await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['livablom:'+n]);
  const old=await db.query('SELECT id FROM reservations WHERE stripe_session_id=$1',[sessionId]);
  if(old.rowCount){await db.query('COMMIT');return res.json({success:true,id:old.rows[0].id});}
  if(req.body.holdId){
   const h=await db.query('SELECT *,start_date::text AS s,end_date::text AS e FROM calendar_booking_holds WHERE id=$1 FOR UPDATE',[req.body.holdId]);const row=h.rows[0];
   if(!row||row.state!=='pending'||row.logement!==n||row.s!==start||row.e!==end||(row.stripe_session_id&&row.stripe_session_id!==sessionId))throw new Error('Blocage incompatible avec le paiement');
  }
  // Les anciennes sessions ouvertes avant déploiement restent traitées et journalisées.
  else console.warn('Paiement ancien sans blocage préalable :',sessionId);
  const r=await db.query(`INSERT INTO reservations(logement,start,"end",title,stripe_session_id) VALUES($1,($2::date+time '18:00'),($3::date+time '11:00'),$4,$5) RETURNING id`,[n,start,end,`Réservation ${n}`,sessionId]);
  if(req.body.holdId)await db.query(`UPDATE calendar_booking_holds SET state='confirmed',stripe_session_id=$2,reservation_id=$3 WHERE id=$1`,[req.body.holdId,sessionId,r.rows[0].id]);
  await db.query('COMMIT');res.json({success:true,id:r.rows[0].id});
 }catch(e){if(db)await db.query('ROLLBACK');fail(res,e);}finally{db?.release();}
});
app.get('/',(req,res)=>res.send('Proxy calendrier LIVABLŌM'));
ready.then(()=>app.listen(process.env.PORT||4000,()=>console.log('Calendrier prêt'))).catch(()=>process.exit(1));
