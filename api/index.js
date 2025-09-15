require("dotenv").config();
const express = require("express");
const webhookRouter = require("./routes/webhook.routes");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/", (_req, res) => res.send("OK"));

// Webhook
app.use("/webhook", webhookRouter);

// Export a handler Vercel can invoke
module.exports = (req, res) => app(req, res);