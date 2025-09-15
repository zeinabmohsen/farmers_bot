const router = require("express").Router();
const {
  verifyWebhook,
  receiveWebhook,
} = require("../controllers/webhook.controller");

// GET: verification
router.get("/", verifyWebhook);

// POST: events (messages + statuses)
router.post("/", receiveWebhook);

module.exports = router;
