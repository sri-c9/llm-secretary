import asyncio
import websockets
import webrtcvad
import time

# Initialize WebRTC VAD with an aggressiveness mode of 2 (1-3, 3 being the most aggressive)
vad = webrtcvad.Vad(2)

# Silence threshold duration (3 seconds)
SILENCE_THRESHOLD = 3.0

# Audio frame duration (in milliseconds)
FRAME_DURATION_MS = 30


async def vad_process(websocket):
    print("Connected to WebSocket server.", websocket)
    silence_start_time = None  # Keeps track of when silence starts
    buffer = bytearray()  # Buffer to accumulate audio frames

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                print(f"Received audio chunk of size: {len(message)} bytes")
                buffer.extend(message)

                # Process audio frames in chunks
                while len(buffer) >= (FRAME_DURATION_MS * 2):  # 16-bit PCM, 16kHz
                    audio_frame = buffer[:FRAME_DURATION_MS * 2]
                    buffer = buffer[FRAME_DURATION_MS * 2:]
                    # Detect whether the frame contains speech
                    is_speech = vad.is_speech(
                        audio_frame, sample_rate=16000)
                    print(f"Frame processed. Is speech: {is_speech}")
                    if is_speech:
                        print("Speech detected.")
                        silence_start_time = None  # Reset silence start time on speech detection
                    else:
                        print("Silence detected.")
                        if silence_start_time is None:
                            silence_start_time = time.time()  # Start timing the silence

                        # Calculate the duration of silence
                        silence_duration = time.time() - silence_start_time
                        if silence_duration >= SILENCE_THRESHOLD:
                            print(f"Silence detected for {SILENCE_THRESHOLD} seconds.")
                            # Here you can perform an action when silence is detected for the threshold duration
                            silence_start_time = None  # Reset silence tracking

            else:
                print("Received non-binary message")
    except websockets.ConnectionClosed:
        print("Connection to WebSocket server closed.")
    except Exception as e:
        print(f"An error occurred: {e}")


async def main():
    ws_url = "ws://localhost:80"
    print(f"Attempting to connect to WebSocket server at: {ws_url}")
    async with websockets.connect(ws_url) as websocket:
        print(f"Connected successfully to: {websocket.path}")
        await vad_process(websocket)

# Run the client
if __name__ == "__main__":
    asyncio.run(main())
