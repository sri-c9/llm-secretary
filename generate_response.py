import asyncio
import websockets
import json
import base64
import shutil
import os
import subprocess
from openai import AsyncOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from dotenv import load_dotenv
import logging

# logging.basicConfig(level=logging.DEBUG)
# logger = logging.getLogger()


# Load environment variables
load_dotenv()

# Define API keys and voice ID
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID")

# Set OpenAI API key
aclient = AsyncOpenAI(api_key=OPENAI_API_KEY)

# Initialize conversation history
# conversation_history = [
#     SystemMessage(
#         content="You are a helpful assistant. Answer all questions to the best of your ability.")
# ]
conversation_history = [
    SystemMessage(
        content="You are Zoya Abidi, a 23 year-old Pakistani-American who just graduated from UC Berkeley. Remember, you really desperately need help with finding jobs right now. Answer all questions to the best of your ability.")
]


def is_installed(lib_name):
    return shutil.which(lib_name) is not None


async def text_chunker(chunks):
    """Split text into chunks, ensuring to not break sentences."""
    splitters = (".", ",", "?", "!", ";", ":", "—",
                 "-", "(", ")", "[", "]", "}", " ")
    buffer = ""

    async for text in chunks:
        if buffer.endswith(splitters):
            yield buffer + " "
            buffer = text
        elif text.startswith(splitters):
            yield buffer + text[0] + " "
            buffer = text[1:]
        else:
            buffer += text

    if buffer:
        yield buffer + " "


async def stream(audio_stream):
    """Stream audio data using mpv player."""
    # MPV version is working
    # if not is_installed("mpv"):
    #     raise ValueError(
    #         "mpv not found, necessary to stream audio. "
    #         "Install instructions: https://mpv.io/installation/"
    #     )

    # mpv_process = subprocess.Popen(
    #     ["mpv", "--no-cache", "--no-terminal", "--", "fd://0"],
    #     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    # )

    # async for chunk in audio_stream:
    #     if chunk:
    #         mpv_process.stdin.write(chunk)
    #         mpv_process.stdin.flush()

    # if mpv_process.stdin:
    #     mpv_process.stdin.close()
    # mpv_process.wait()

    print("Started streaming audio to Node.js server")
    uri = "ws://localhost:3000/media"

    async with websockets.connect(uri) as websocket:
        print("Connected to Websocket at", websocket.path)

        # Sending media stream chunks to the WebSocket (media)
        async for chunk in audio_stream:
            if chunk:
                base64_audio = base64.b64encode(chunk).decode('utf-8')
                print("Encoded audio ")

                await websocket.send(json.dumps({
                    "event": "media",
                    "media": {
                        "track": "outbound",  # Indicating outbound media stream
                        "payload": base64_audio
                    }
                }))
                print("Sent audio to Node.js server")
                # Send mark message to signify

            print("Sent chunk to websocket: ", websocket.path)
        print("Done sending audio")


async def text_to_speech_input_streaming(voice_id, text_iterator):
    """Send text to ElevenLabs API and stream the returned audio."""
    uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_turbo_v2_5"

    async with websockets.connect(uri) as websocket:
        await websocket.send(json.dumps({
            "text": " ",
            "voice_settings": {"stability": 0.2, "similarity_boost": 0.75, "style": 0.8, "use_speaker_boost": True},
            "xi_api_key": ELEVENLABS_API_KEY,
        }))

        async def listen():
            """Listen to the websocket for audio data and stream it."""
            while True:
                try:
                    message = await websocket.recv()
                    data = json.loads(message)
                    if data.get("audio"):
                        yield base64.b64decode(data["audio"])
                    elif data.get('isFinal'):
                        break
                except websockets.exceptions.ConnectionClosed:
                    print("Connection closed at path: ", websocket.path)
                    break

        listen_task = asyncio.create_task(stream(listen()))

        async for text in text_chunker(text_iterator):
            await websocket.send(json.dumps({"text": text}))

        await websocket.send(json.dumps({"text": ""}))

        await listen_task


async def chat_completion(query):
    """Retrieve text from OpenAI and pass it to the text-to-speech function."""
    global conversation_history

    # Add the new user message to the conversation history
    conversation_history.append(HumanMessage(content=query))

    # Prepare messages for the OpenAI API
    messages = [{"role": "system" if isinstance(msg, SystemMessage) else "assistant" if isinstance(msg, AIMessage) else "user",
                 "content": msg.content} for msg in conversation_history]

    # Call OpenAI API
    response = await aclient.chat.completions.create(
        model='gpt-4o-mini',
        messages=messages,
        temperature=1,
        stream=True
    )

    full_response = ""

    async def text_iterator():
        nonlocal full_response
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                full_response += delta.content
                yield delta.content

    await text_to_speech_input_streaming(VOICE_ID, text_iterator())

    # Update conversation history with the AI's response
    conversation_history.append(AIMessage(content=full_response))

    print("AI Response in chat_completions: ", full_response)

    # Limit conversation history to last 10 messages (5 exchanges)
    # if len(conversation_history) > 11:  # 11 to keep the initial system message
    #     conversation_history = [
    #         conversation_history[0]] + conversation_history[-10:]


async def handle_websocket(websocket):
    """Handle WebSocket connections from Node.js server."""
    try:
        async for message in websocket:
            print(f"Received message: {message}")  # Log every received message
            try:
                # Assume the message is a JSON string containing a 'transcription' field
                data = json.loads(message)
                transcription = data.get('transcription')
                if transcription:
                    print(f"Processing transcription: {transcription}")
                    await chat_completion(transcription)
                else:
                    print("Received message without transcription")
            except json.JSONDecodeError:
                print(f"Received non-JSON message: {message}")
    except websockets.ConnectionClosedError as e:
        print(f"Connection closed with error: {e}")

    except Exception as e:
        print(f"Unexpected error: {e}")


async def main():
    server = await websockets.serve(handle_websocket, "localhost", 3001)
    print(f"WebSocket server started on ws://localhost:3001")

    # Keep the server running
    await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
