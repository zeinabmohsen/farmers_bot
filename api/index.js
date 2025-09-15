require("dotenv").config();
const express = require("express");
const webhookRouter = require("./routes/webhook.routes");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/", (_req, res) => res.send("OK"));

// Webhook routes live at /api/webhook
app.use("/webhook", webhookRouter);

console.log("Webhook routes set up at /webhook");

// Error handler
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
});

// ✅ IMPORTANT: let Vercel invoke your Express app
module.exports = (req, res) => app(req, res);
