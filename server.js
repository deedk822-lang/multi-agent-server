// server.js - Unified Multi-Agent Server
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import axios from "axios";
import FormData from "form-data";
import { LRUCache } from "lru-cache";

dotenv.config();
const app = express();

// --- helpers & config ---------------------------------------------------
const {
  PORT = 8080,
  SITE_BASE_URL,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_WEBHOOK_SECRET,
  FLW_SECRET_KEY,
  FLW_WEBHOOK_SECRET,
  FLW_COUNTRY = "ZA",
  AIRTABLE_API_KEY,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE,
  DOWNLOAD_BASE_URL,
  WHATSAPP_CHANNEL_LINK,
  // Agent Credentials
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID,
  MPESA_SHORTCODE,
  MPESA_PASSKEY,
  STABILITY_API_KEY,
  ELEVENLABS_API_KEY,
  HEYGEN_API_KEY,
} = process.env;

const conversationState = new LRUCache({ max: 1000, ttl: 1000 * 60 * 60 });

const AT_BASE = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`;

async function airtableUpsert(external_id, fields) {
  const q = new URLSearchParams({ filterByFormula: `{external_id}='${external_id}'`, maxRecords: "1" });
  const found = await fetch(`${AT_BASE}?${q}`, { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }).then(r=>r.json());
  if (found?.records?.length) return found.records[0];
  const res = await fetch(AT_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ records: [{ fields: { external_id, ...fields } }] })
  }).then(r=>r.json());
  return res.records?.[0];
}

function deliverableURL(product_id) {
  const file = product_id === "PDF_R99" ? "explainer.pdf" :
               product_id === "BRIEF_R299" ? "briefing-pack.pdf" :
               "download.pdf";
  return `${DOWNLOAD_BASE_URL}/${file}`;
}

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_ID}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { preview_url: false, body: text },
  };
  await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

app.use(express.json());
const rawParser = bodyParser.raw({ type: "*/*" });

// === AGENT ENDPOINTS =======================================================
app.post("/api/agents/datahunter/whatsapp", async (req, res) => {
  try {
    const from = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    const text = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;
    if (!from || !text) return res.sendStatus(200);

    let state = conversationState.get(from) || { stage: 0, answers: {} };
    let reply = "";
    switch (state.stage) {
      case 0:
        reply = "Hi! Quick 3 questions:\n1) What do you need?"; state.stage = 1; break;
      case 1:
        state.answers.need = text; reply = "2) What is your budget?"; state.stage = 2; break;
      case 2:
        state.answers.budget = text; reply = "3) Where are you located?"; state.stage = 3; break;
      case 3:
        state.answers.location = text; reply = "Thanks! Want to try M-Pesa test checkout? Reply YES."; state.stage = 4; break;
      case 4:
        if (text.trim().toLowerCase() === "yes") {
          reply = "Great! Check your phone for an M-Pesa prompt.";
          console.log(`Triggering M-Pesa for ${from} with answers:`, state.answers);
        } else { reply = "No problem. Let me know if you need anything else!"; }
        state.stage = 0; break;
    }
    conversationState.set(from, state);
    await sendWhatsAppMessage(from, reply);
    res.sendStatus(200);
  } catch (e) { console.error("WhatsApp Agent Error:", e.message); res.sendStatus(500); }
});

app.post("/api/agents/datahunter/mpesa-callback", (req, res) => {
    console.log('Received M-Pesa callback:', req.body);
    res.status(200).send('Callback received.');
});

app.post("/api/agents/stability/generate", async (req, res) => {
  try {
    const prompt = req.body.headline || 'A beautiful African savanna at sunset, photorealistic';
    const formData = new FormData();
    formData.append('prompt', prompt); formData.append('output_format', 'png');
    const response = await axios.post('https://api.stability.ai/v2beta/stable-image/generate/sd3', formData,
      { headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${STABILITY_API_KEY}`, 'Accept': 'image/*' }, responseType: 'arraybuffer' });
    res.setHeader('Content-Type', 'image/png'); res.send(response.data);
  } catch (e) { console.error("Stability Agent Error:", e.response?.data?.toString() || e.message); res.status(500).json({ error: "Failed to generate image." }); }
});

// === MVML (Minimal-Viable Money Loop) ROUTES GO HERE ===
// Note: Paste the full MVML code from our previous messages here

// --- Server Start --------------------------------------------------------
app.get("/", (_, res) => res.send("Multi-Agent Server is up and running."));
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
