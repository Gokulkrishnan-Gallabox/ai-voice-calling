import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import './App.css';

function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isInCall, setIsInCall] = useState(false);

  
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    // Create socket connection
    const newSocket = io('http://localhost:3001');
    setSocket(newSocket);

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('message', (data) => {
      setMessages(prev => [...prev, data]);
    });

    // WebRTC signaling handlers
    newSocket.on('answer', async (answer) => { 
      if (peerConnection.current) {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    newSocket.on('ice-candidate', async (candidate) => {
      if (peerConnection.current && candidate) {
        try {
          await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error('Failed to add ICE candidate', err);
        }
      }
    });

    // Cleanup on unmount
    return () => {
      newSocket.close();
    };
  }, []);

  const startCall = async () => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStream.current = stream;
      
      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      peerConnection.current = pc;

      // Add local stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle incoming tracks
      pc.ontrack = (event) => {
        remoteStream.current = event.streams[0];
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('ice-candidate', event.candidate);
        }
      };

      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket?.emit('offer', offer);

      setIsInCall(true);

    } catch (err) {
      console.error('Failed to start call:', err);
    }
  };

  const endCall = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    if (remoteStream.current) {
      remoteStream.current = null;
    }
    setIsInCall(false);

    
    // Notify server
    socket?.emit('end-call');
  };


  const sendMessage = () => {
    if (socket && inputMessage.trim()) {
      socket.emit('message', inputMessage);
      setInputMessage('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>🎤 Mastra Voice Agent</h1>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <div className="status-dot"></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </header>

        {/* Call Interface */}
        <div className="call-container">
          {!isInCall ? (
            <button 
              onClick={startCall}
              disabled={!isConnected}
              className="call-button start-call"
            >
              📞 Start Call
            </button>
          ) : (
              <button 
                onClick={endCall}
                className="call-button end-call"
              >
                ❌ End Call
              </button>
          )}
        </div>

        {/* Audio Elements */}
        <audio ref={localAudioRef} autoPlay muted />
        <audio ref={remoteAudioRef} autoPlay />

        <div className="chat-container">
          <div className="messages">
            {messages.map((message, index) => (
              <div key={index} className="message">
                {message}
              </div>
            ))}
            {messages.length === 0 && (
              <div className="no-messages">
                No messages yet. Start the conversation!
              </div>
            )}
          </div>

          <div className="input-container">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              disabled={!isConnected}
            />
            <button 
              onClick={sendMessage}
              disabled={!isConnected || !inputMessage.trim()}
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
