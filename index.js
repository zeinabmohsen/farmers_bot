require("dotenv").config();
const express = require("express");
const webhookRouter = require("./webhook.routes");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health
app.get("/", (_req, res) => res.send("OK"));

// Webhook
app.use("/webhook", webhookRouter);

// Export the Express app (Vercel wraps it as a serverless function)
module.exports = app;         // CommonJS is fine on Vercel Node runtime
// or: export default app;
