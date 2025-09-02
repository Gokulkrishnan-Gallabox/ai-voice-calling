# Mastra Voice Agent Client

A React client application for the Mastra Voice Agent with real-time Socket.IO communication.

## Features

- Real-time connection status indicator
- Live chat interface
- Beautiful, modern UI design
- Responsive design for mobile and desktop
- TypeScript support

## Setup

1. Install dependencies:

```bash
npm install
# or
yarn install
```

2. Start the development server:

```bash
npm start
# or
yarn start
```

The app will open at [http://localhost:3001](http://localhost:3001).

## Usage

1. Make sure the server is running on `http://localhost:3000`
2. The client will automatically connect to the server
3. You'll see a green "Connected" indicator when the socket connection is established
4. Type messages in the input field and press Enter or click Send
5. Messages will be broadcast to all connected clients

## Connection Status

- **Green dot + "Connected"**: Successfully connected to the server
- **Red dot + "Disconnected"**: Connection lost or server unavailable

## Available Scripts

- `npm start` - Runs the app in development mode
- `npm run build` - Builds the app for production
- `npm test` - Launches the test runner
- `npm run eject` - Ejects from Create React App (one-way operation)

## Technologies Used

- React 18
- TypeScript
- Socket.IO Client
- CSS3 with modern styling
- Create React App
