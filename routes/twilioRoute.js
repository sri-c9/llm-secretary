const express = require("express");
const twilio = require("twilio");
const VoiceResponse = twilio.twiml.VoiceResponse;

const router = express.Router();

router.get("/", async (req, res) => {
  res.send("Handshake received");
});

router.post("/incoming", async (req, res) => {
  try {
    const fromNumber = req.body.From;
    console.log("Incoming call from:", fromNumber);

    const response = new VoiceResponse();
    const start = response.start();
    start.stream({
      name: "LLM Secretary",
      url: "wss://loved-viper-notable.ngrok-free.app/ws-server",
    });

    const connect = response.connect();
    connect.stream({
      url: "wss://loved-viper-notable.ngrok-free.app/ws-server",
    });

    response.say(
      "This TwiML instruction is unreachable unless the Stream is ended by your WebSocket server."
    );

    res.type("text/xml");
    res.send(response.toString());
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    res.status(400).send(`Webhook error: ${errorMessage}`);
  }
});

module.exports = router;
