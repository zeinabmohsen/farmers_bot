require("dotenv").config();
const express = require("express");
const webhookRouter = require("./routes/webhook.routes");

const app = express();
app.use(express.json());

// Health
app.get("/", (_req, res) => res.send("OK"));

// Webhook routes
app.use("/webhook", webhookRouter);

// Error handler (last)
app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Quick manual test: uncomment and put your own tester number
  // const { sendText } = require('./services/whatsapp.service');
  // sendText('96170059215', 'Hello World from server start!');
});
