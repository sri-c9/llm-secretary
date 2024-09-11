import asyncio
import websockets
import json
import base64
import shutil
import os
import subprocess
from openai import AsyncOpenAI
from dotenv import load_dotenv

load_dotenv()

# Define API keys and voice ID
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
VOICE_ID = os.getenv('ELEVENLABS_CUSTOM_VOICE_ID')


# Set OpenAI API key
aclient = AsyncOpenAI(api_key=OPENAI_API_KEY)


def is_installed(lib_name):
    return shutil.which(lib_name) is not None


async def text_chunker(chunks):
    """Split text into chunks, ensuring to not break sentences."""
    splitters = (".", ",", "?", "!", ";", ":", "—",
                 "-", "(", ")", "[", "]", "}", " ")
    buffer = ""

    async for text in chunks:
        if not text:
            continue

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
    if not is_installed("mpv"):
        raise ValueError(
            "mpv not found, necessary to stream audio. "
            "Install instructions: https://mpv.io/installation/"
        )

    mpv_process = subprocess.Popen(
        ["mpv", "--no-cache", "--no-terminal", "--", "fd://0"],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    print("Started streaming audio")
    try:
        async for chunk in audio_stream:
            if chunk:
                mpv_process.stdin.write(chunk)
                mpv_process.stdin.flush()
    finally:
        if mpv_process.stdin:
            mpv_process.stdin.close()
        mpv_process.wait()


async def text_to_speech_input_streaming(voice_id, text_iterator):
    """Send text to ElevenLabs API and stream the returned audio."""
    uri = f"wss://api.elevenlabs.io/v1/text-to-speech/{
        voice_id}/stream-input?model_id=eleven_turbo_v2_5"

    try:
        async with websockets.connect(uri) as websocket:
            await websocket.send(json.dumps({
                "text": " ",
                "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.7, "use_speaker_boost": True},
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
                        print("Connection closed")
                        break

            listen_task = asyncio.create_task(stream(listen()))

            try:
                async for text in text_chunker(text_iterator):
                    print(f"Sending text to websocket: {text}")
                    await websocket.send(json.dumps({"text": text, "try_trigger_generation": True}))

                await websocket.send(json.dumps({"text": ""}))
            except Exception as e:
                print(f"Error while sending text: {e}")
            finally:
                await listen_task
    except websockets.exceptions.WebSocketException as e:
        print(f"WebSocket connection error: {e}")
    except Exception as e:
        print(f"Unexpected error: {e}")


async def chat_completion(query):
    """Retrieve text from OpenAI and pass it to the text-to-speech function."""
    try:
        response = await aclient.chat.completions.create(
            model='gpt-4o-mini',
            messages=[{'role': 'user', 'content': query}],
            temperature=1,
            stream=True
        )

        async def text_iterator():
            async for chunk in response:
                delta = chunk.choices[0].delta
                if delta.content:
                    print(f"Received chunk: {delta.content}")
                    yield delta.content

        await text_to_speech_input_streaming(VOICE_ID, text_iterator())
    except Exception as e:
        print(f"Error in chat completion: {e}")

# Main execution


async def main():
    user_query = "You are Zoya Abidi, and you lied about hearing Sri saying 'thing 1, thing 2, etc.' Apologize sincerely for your crimes. Explicilty mention what you are sorry about."
    await chat_completion(user_query)

if __name__ == "__main__":
    asyncio.run(main())
