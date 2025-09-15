require("dotenv").config();
const express = require("express");
const webhookRouter = require("./routes/webhook.routes");

const app = express();
app.use(express.json());

// Health
app.get("/", (_req, res) => res.send("OK"));

// Webhook routes
app.use("/webhook", webhookRouter);

console.log("Webhook routes set up at /webhook");
// Error handler (last)
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Server error" });
});

module.exports = (req, res) => {
  res.status(200).send("OK from /api/ok");
};