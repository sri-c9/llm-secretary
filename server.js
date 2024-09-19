import express from "express";
import expressWebSocket from "express-ws";
import { engine } from "express-handlebars";
import websocketStream from "websocket-stream/stream.js";
import WebSocket, { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { SpeechClient } from "@google-cloud/speech";

dotenv.config();

const app = express();
expressWebSocket(app, null, { perMessageDeflate: false });
app.engine("hbs", engine());
app.set("view engine", "hbs");

const payloadTemplate = {};

const PORT = process.env.EXPRESS_PORT || 3000;

const speechClient = new SpeechClient();
app.use(express.json());

app.post("/start-stream", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  const host = req.headers["x-original-host"] || req.hostname;
  res.render("twiml", { host, layout: false });
});

const pythonWsServer = new WebSocket("ws://localhost:3001");
pythonWsServer.on("connection", (ws) => {
  console.log("Connected to Python audio-processing WebSocket");

  ws.on("error", (error) => {
    console.error("Error in Python WebSocket:", error);
  });

  ws.send("Connection established with Python WebSocket server");
});

let mediaStream;

app.ws("/media", (ws) => {
  mediaStream = websocketStream(ws, { binary: false });

  const recognizeStream = speechClient.streamingRecognize({
    config: {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: "en-US",
    },
    interimResults: false,
  });

  mediaStream.on("connected", (connection) => {
    console.log("mediaStream is connected", connection);
  });

  mediaStream.on("start", (start) => {
    console.log("data sent on start event", start);
    payloadTemplate["streamSID"] = start.streamSID;
  });

  mediaStream.on("data", async (data) => {
    try {
      const parsedData = JSON.parse(data);
      if (parsedData.event === "start") {
        console.log("Call started");
      } else if (parsedData.event === "media") {
        const audioBuffer = Buffer.from(parsedData.media.payload, "base64");
        recognizeStream.write(audioBuffer);
      } else if (parsedData.event === "stop") {
        console.log("Call ended");
        recognizeStream.end();
      }
    } catch (error) {
      console.error("Error processing media stream:", error);
    }
  });

  recognizeStream.on("data", async (data) => {
    if (data.results[0] && data.results[0].alternatives[0]) {
      const transcription = data.results[0].alternatives[0].transcript;
      console.log(`Transcription: ${transcription}`);

      try {
        pythonWsServer.send(JSON.stringify({ transcription: transcription }));
      } catch (error) {
        console.error("Error processing AI response:", error);
      }
    }
  });

  recognizeStream.on("error", (error) => {
    console.error("Error in Google Speech-to-Text stream:", error);
  });

  mediaStream.on("error", (error) => {
    console.error("Error in media stream:", error);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export { mediaStream };
