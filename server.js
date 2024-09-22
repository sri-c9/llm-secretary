import express from "express";
import expressWebSocket from "express-ws";
import { engine } from "express-handlebars";
import websocketStream from "websocket-stream/stream.js";
import WebSocket from "ws";
import dotenv from "dotenv";
import { SpeechClient } from "@google-cloud/speech";
import morgan from "morgan";
import VoiceResponse from "twilio/lib/twiml/VoiceResponse.js";

dotenv.config();

const app = express();
expressWebSocket(app, null, { perMessageDeflate: false });

app.engine("hbs", engine());
app.set("view engine", "hbs");

const PORT = process.env.EXPRESS_PORT || 3000;

const speechClient = new SpeechClient();
app.use(express.json());

app.post("/start-stream", (req, res) => {
  // res.setHeader("Content-Type", "application/xml");
  // const host = req.headers["x-original-host"] || req.hostname;
  // console.log("/start-stream host:", host);
  // res.render("twiml", { host, layout: false });

  const twiml = new VoiceResponse();
  twiml.connect().stream({
    url: `wss://${process.env.SERVER_DOMAIN}/media`,
  });

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

// Function to connect to the Python WebSocket server with retry mechanism
function connectToPythonServer(retryAttempt = 0) {
  const maxRetries = 5;
  const baseDelay = 1000; // 1 second

  const pythonWsServer = new WebSocket("ws://localhost:3001");

  pythonWsServer.on("open", () => {
    console.log("Connected to Python audio-processing WebSocket");
    retryAttempt = 0; // Reset retry attempt on successful connection
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

  const mediaStream = websocketStream(ws, { binary: true });

  const recognizeStream = speechClient.streamingRecognize({
    config: {
      encoding: "MULAW",
      sampleRateHertz: 8000,
      languageCode: "en-US",
    },
    interimResults: false,
  });

  let streamSid;

  // Handle incoming data from Twilio MediaStream
  mediaStream.on("data", async (data) => {
    try {
      const parsedData = JSON.parse(data);

      if (parsedData.event === "start") {
        streamSid = parsedData.start.streamSid;
        console.log("Call started with streamSid:", streamSid);
      } else if (parsedData.event === "media") {
        const audioBuffer = Buffer.from(parsedData.media.payload, "base64");

        if (parsedData.media.track === "outbound") {
          console.log("Outbound media received from Python");
          parsedData["streamSid"] = streamSid;
          // Forward the media back to Twilio
          mediaStream.write(JSON.stringify(parsedData));
          console.log("Sent audio back to Twilio");
        } else if (parsedData.media.track === "inbound") {
          // Send inbound audio to Google Speech-to-Text
          recognizeStream.write(audioBuffer);
        } else {
          throw new Error(`Unrecognized track: ${parsedData.media.track}`);
        }
      } else if (parsedData.event === "stop") {
        console.log("Call ended");
        recognizeStream.end();
        mediaStream.end();
      } else if (parsedData.event === "mark") {
        // Write mark message to signal end of interaction
        console.log("Twilio sent mark event, playback completed");
      } else if (parsedData.event === "pythonMark") {
        parsedData.event = "mark";
        mediaStream.write(JSON.stringify(parsedData));
        console.log(
          "Sent mark message as end of interaction signaled by Python server"
        );
        // Write mark message to signal end of interaction
        console.log("Twilio sent mark event, playback completed");
      }
    } catch (error) {
      console.error("Error processing media stream:", error);
    }
  });

  // Handle transcription result from Google Speech-to-Text
  recognizeStream.on("data", (data) => {
    if (data.results[0] && data.results[0].alternatives[0]) {
      const transcription = data.results[0].alternatives[0].transcript;
      console.log(`Transcription: ${transcription}`);

      try {
        pythonWsServer.send(JSON.stringify({ transcription }));
      } catch (error) {
        console.error("Error sending transcription to Python server:", error);
      }
    }
  });

  // WebSocket error handling
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });

  mediaStream.on("error", (error) => {
    console.error("Error in media stream:", error);
  });

  recognizeStream.on("error", (error) => {
    console.error("Error in Google Speech-to-Text stream:", error);
  });

  ws.on("close", (code, reason) => {
    console.log(`WebSocket closed: Code ${code}, Reason: ${reason.toString()}`);
    if (reason) {
      console.log(`Close reason (decoded): ${Buffer.from(reason).toString()}`);
    }
    mediaStream.end(); // Ensure media stream is closed on WebSocket close
    recognizeStream.end(); // End the Google Speech stream
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
