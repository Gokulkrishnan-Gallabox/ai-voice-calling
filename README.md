# 🎙️ Mastra Voice Agent

A simple voice agent application that provides real-time audio communication through WebRTC. The application combines both server and client functionality in a single Express.js server.

## Features

- **Real-time Voice Communication**: WebRTC-based audio calls
- **Simple Web Interface**: Clean, responsive HTML interface
- **WhatsApp Integration**: Support for WhatsApp voice calls via webhook
- **Socket.IO Signaling**: Efficient real-time communication

## Project Structure

```
mastra-voice-agent/
├── server/
│   ├── src/                    # TypeScript source files
│   │   ├── index.ts           # Main server with Express and Socket.IO
│   │   ├── call-session.ts    # WebRTC call session management
│   │   ├── voice-agent.ts     # Voice processing logic
│   │   ├── audio-processor.ts # Audio processing utilities
│   │   └── audio-utils.ts     # Audio utility functions
│   ├── public/                # Static web files
│   │   └── index.html         # Voice agent web interface
│   ├── dist/                  # Compiled JavaScript
│   └── package.json
└── recordings/                # Audio recordings storage
```

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Navigate to the server directory:

   ```bash
   cd server
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Build the application:

   ```bash
   npm run build
   ```

4. Start the server:

   ```bash
   npm start
   ```

   For development with auto-reload:

   ```bash
   npm run dev
   ```

### Usage

1. Open your browser and navigate to `http://localhost:3001`
2. You'll see the Voice Agent interface with a "📞 Call" button
3. Click the button to start a voice call
4. Grant microphone permissions when prompted
5. Start speaking - the audio will be processed by the voice agent
6. Click "📞 End Call" to terminate the connection

## API Endpoints

- `GET /` - Serves the main web interface
- `POST /whatsapp/meta-tech-partner/accounts/.../webhook` - WhatsApp webhook for voice calls
- `GET /whatsapp/meta-tech-partner/accounts/.../webhook` - WhatsApp webhook verification

## WebSocket Events

### Client to Server

- `call-offer` - WebRTC offer with SDP
- `ice-candidate` - ICE candidate for connection establishment
- `terminate` - End the current call

### Server to Client

- `connected` - Connection established
- `call-answer` - WebRTC answer with SDP
- `ice-candidate` - ICE candidate from server

## Configuration

Environment variables:

- `PORT` - Server port (default: 3001)
- `WHATSAPP_ACCESS_TOKEN` - WhatsApp API access token
- `WHATSAPP_VERIFY_TOKEN` - WhatsApp webhook verification token

## Development

The application uses:

- **Express.js** for HTTP server and static file serving
- **Socket.IO** for real-time WebSocket communication
- **WebRTC** for peer-to-peer audio communication
- **TypeScript** for type safety
- **Mastra** voice processing libraries

## License

MIT
