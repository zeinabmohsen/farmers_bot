const axios = require("axios");

const GRAPH_VERSION = process.env.GRAPH_VERSION || "v22.0";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

if (!PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
  console.warn(
    "[WARN] PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN missing. Check your .env",
  );
}

const client = axios.create({
  baseURL: `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}`,
  headers: {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  timeout: 10000,
});

async function send(payload) {
  const url = `/messages`;
  const { data } = await client.post(url, payload);
  return data;
}

// Text (simple)
exports.sendText = async (to, body) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "text",
      text: { body },
    };
    const data = await send(payload);
    console.log("[SEND TEXT ✅]", data);
    return data;
  } catch (err) {
    console.error("[SEND TEXT ❌]", err.response?.data || err.message);
  }
};

// Text replying to a message (context.message_id)
exports.sendTextReplying = async (to, body, messageId) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      context: { message_id: messageId },
      type: "text",
      text: { body },
    };
    const data = await send(payload);
    console.log("[REPLY TEXT ✅]", data);
    return data;
  } catch (err) {
    console.error("[REPLY TEXT ❌]", err.response?.data || err.message);
  }
};

// Interactive: List
exports.sendList = async (to) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "interactive",
      interactive: {
        type: "list",
        header: { type: "text", text: "Message Header" },
        body: { text: "This is an interactive list message" },
        footer: { text: "This is the message footer" },
        action: {
          button: "Tap for options",
          sections: [
            {
              title: "First Section",
              rows: [
                {
                  id: "first_option",
                  title: "First option",
                  description: "Description of the first option",
                },
                {
                  id: "second_option",
                  title: "Second option",
                  description: "Description of the second option",
                },
              ],
            },
            {
              title: "Second Section",
              rows: [{ id: "third_option", title: "Third option" }],
            },
          ],
        },
      },
    };
    const data = await send(payload);
    console.log("[SEND LIST ✅]", data);
    return data;
  } catch (err) {
    console.error("[SEND LIST ❌]", err.response?.data || err.message);
  }
};

// Interactive: Reply Buttons
exports.sendReplyButtons = async (to) => {
  try {
    const payload = {
      messaging_product: "whatsapp",
      to: String(to),
      type: "interactive",
      interactive: {
        type: "button",
        header: { type: "text", text: "Message Header" },
        body: { text: "This is an interactive reply buttons message" },
        footer: { text: "This is the message footer" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "first_button", title: "First Button" },
            },
            {
              type: "reply",
              reply: { id: "second_button", title: "Second Button" },
            },
          ],
        },
      },
    };
    const data = await send(payload);
    console.log("[SEND BUTTONS ✅]", data);
    return data;
  } catch (err) {
    console.error("[SEND BUTTONS ❌]", err.response?.data || err.message);
  }
};
