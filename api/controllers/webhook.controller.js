const {
  sendText,
  sendTextReplying,
  sendList,
  sendReplyButtons,
} = require("../services/whatsapp.service");
const { matchFaq, RESPONSES } = require("../nlp/faq.matcher");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "farmers-token-api-wp-verify";

/**
 * GET /webhook — verification
 */
exports.verifyWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
};

/**
 * POST /webhook — receive events (messages + statuses)
 * ACK fast, then process safely.
 */
exports.receiveWebhook = async (req, res) => {
  // Acknowledge within 10s
  res.status(200).send("EVENT_RECEIVED");

  try {
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};

        // ----- Status updates (delivered/read/etc.)
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        for (const s of statuses) {
          console.log("[MESSAGE STATUS]", {
            id: s.id,
            status: s.status,
            timestamp: s.timestamp,
            recipient_id: s.recipient_id,
          });
        }

        // ----- Incoming messages
        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const m of messages) {
          console.log("[INCOMING MESSAGE]", JSON.stringify(m, null, 2));

          const from = String(m.from);
          const type = m.type;

          // 1) Text messages → try FAQ first, then fallbacks
          if (type === "text" && m.text?.body) {
            const userText = (m.text.body || "").trim();

            // Try rule-based Arabic FAQ
            const faqAnswer = matchFaq(userText);
            if (faqAnswer) {
              await sendTextReplying(from, faqAnswer, m.id);
              continue; // handled
            }

            // Fallback commands you already support
            const t = userText.toLowerCase();
            if (t === "hello") {
              await sendTextReplying(from, "Hello. How are you?", m.id);
            } else if (t === "list") {
              await sendList(from);
            } else if (t === "buttons") {
              await sendReplyButtons(from);
            } else {
              // Final fallback: Arabic help
              await sendText(from, RESPONSES.help);
            }
          }

          // 2) Interactive replies (list/button)
          if (type === "interactive" && m.interactive) {
            const intType = m.interactive.type;

            if (intType === "list_reply") {
              const { id, title } = m.interactive.list_reply || {};
              await sendText(from, `You selected: ${title} (ID: ${id})`);
            }

            if (intType === "button_reply") {
              const { id, title } = m.interactive.button_reply || {};
              await sendText(from, `You selected: ${title} (ID: ${id})`);
            }
          }

          // 3) TODO: handle images later (Phase 1 photo pipeline)
          // if (type === 'image' && m.image?.id) { ... }
        }
      }
    }
  } catch (e) {
    console.error("Webhook processing error:", e);
  }
};
