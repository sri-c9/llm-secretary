import express from "express";
import expressWebSocket from "express-ws";
import { engine } from "express-handlebars";
import websocketStream from "websocket-stream/stream.js";
import WebSocket from "ws";
import dotenv from "dotenv";
import { SpeechClient } from "@google-cloud/speech";
import pino from "pino";

dotenv.config();

const app = express();
expressWebSocket(app, null, { perMessageDeflate: false });
app.engine("hbs", engine());
app.set("view engine", "hbs");

const logger = pino();
logger.info("Hello from Pino logger");

const PORT = process.env.EXPRESS_PORT || 3000;

const speechClient = new SpeechClient();
app.use(express.json());

app.post("/start-stream", (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  const host = req.headers["x-original-host"] || req.hostname;
  res.render("twiml", { host, layout: false });
});

function connectToPythonServer(retryAttempt = 0) {
  const maxRetries = 5;
  const baseDelay = 1000; // 1 second

  const pythonWsServer = new WebSocket("ws://localhost:3001");

  pythonWsServer.on("open", () => {
    console.log("Connected to Python audio-processing WebSocket");
    // Reset retry attempt on successful connection
    retryAttempt = 0;
  });

  pythonWsServer.on("error", (error) => {
    console.error("Error in Python WebSocket:", error);
    if (retryAttempt < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryAttempt);
      console.log(`Retrying connection in ${delay}ms...`);
      setTimeout(() => connectToPythonServer(retryAttempt + 1), delay);
    } else {
      console.error(
        "Max retry attempts reached. Unable to connect to Python server."
      );
    }
  });

  return pythonWsServer;
}

const pythonWsServer = connectToPythonServer();

app.ws("/media", (ws, req) => {
  console.log("New WebSocket connection attempt");

  const mediaStream = websocketStream(ws, { binary: false });

  const recognizeStream = speechClient.streamingRecognize({
    config: {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: "en-US",
    },
    interimResults: false,
  });

  let streamSid;
  mediaStream.on("data", async (data) => {
    try {
      const parsedData = JSON.parse(data);
      if (parsedData.event === "start") {
        streamSid = parsedData.start.streamSid;
        console.log("Call started with streamSid:", streamSid);
      } else if (parsedData.event === "media") {
        const audioBuffer = Buffer.from(parsedData.media.payload, "base64");
        switch (parsedData.media.track) {
          case "outbound":
            console.log("Outbound media received from Python");
            // Send the audio data back to Twilio
            ws.send(
              JSON.stringify({
                event: "media",
                streamSid: streamSid,
                media: {
                  payload: parsedData.media.payload,
                },
              })
            );
            console.log("Sent audio back to Twilio");

            ws.send(
              JSON.stringify({
                event: "mark",
                streamSid: streamSid,
                mark: {
                  name: "Done sending AI audio for this chunk",
                },
              })
            );
            break;
          case "inbound":
            recognizeStream.write(audioBuffer);
            break;
          default:
            throw new Error(`Unrecognized track: ${parsedData.media.track}`);
        }
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
        console.error("Error sending transcription to Python server:", error);
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
