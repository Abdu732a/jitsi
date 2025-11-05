import React, { useEffect, useRef, useState } from 'react';

// --- TypeScript Definitions ---
// Extend the Window interface to include JitsiMeetExternalAPI for global access
declare global {
  interface Window {
    JitsiMeetExternalAPI?: any;
  }
}

// FIX: Importing the JSX type explicitly fixes the Netlify build error (TS2503)
import type { JSX } from 'react/jsx-runtime';

// Props for the helper button component
interface ControlButtonProps {
  onClick: () => void;
  label: string;
  className?: string;
}

// Helper component for control buttons - uses custom CSS class 'app-btn'
const ControlButton: React.FC<ControlButtonProps> = ({ onClick, label, className = '' }) => {
  return (
    <button
      onClick={onClick}
      className={`app-btn ${className}`}
    >
      {label}
    </button>
  );
};

// --- Main App Component ---
export default function App(): JSX.Element {
  // State for user inputs and application status
  const [roomName, setRoomName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [meetingStarted, setMeetingStarted] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Refs for the Jitsi API instance and the container DOM element
  const jitsiApiRef = useRef(null);
  const jitsiContainerRef = useRef(null);
  const isMountedRef = useRef(true); // To prevent state updates on unmounted component

  // 1) Load the Jitsi external API script (only once on mount)
  useEffect(() => {
    isMountedRef.current = true;

    // Check if script is already loaded
    if (window.JitsiMeetExternalAPI) {
      setScriptLoaded(true);
      return;
    }

    // Create and append the Jitsi API script
    const script = document.createElement('script');
    script.src = 'https://meet.jit.si/external_api.js';
    script.async = true;
    script.onload = () => {
      if (isMountedRef.current) setScriptLoaded(true);
    };
    script.onerror = () => {
      console.error('Failed to load Jitsi API script.');
      if (isMountedRef.current) {
        setScriptLoaded(false);
      }
    };
    document.head.appendChild(script);

    // Cleanup: set ref to false on unmount
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 2) Initialize / dispose Jitsi based on meetingStarted + scriptLoaded
  useEffect(() => {
    let didInit = false;
    let pollAttempts = 0;
    const MAX_POLL = 12; // try for up to ~6 seconds (12 * 500ms)

    // Only proceed if script is loaded, meeting is requested, and container ref exists
    if (!scriptLoaded || !meetingStarted || !jitsiContainerRef.current) {
      return;
    }

    setIsLoading(true);

    const initJitsi = () => {
      // Guard: ensure component still mounted
      if (!isMountedRef.current) return;

      // If API isn't ready yet, retry with polling
      if (!window.JitsiMeetExternalAPI) {
        pollAttempts++;
        if (pollAttempts <= MAX_POLL) {
          setTimeout(initJitsi, 500);
          return;
        } else {
          console.error('Jitsi API never became available after max retries.');
          if (isMountedRef.current) {
            setIsLoading(false);
            setMeetingStarted(false); // Reset state to show form again
          }
          return;
        }
      }

      try {
        const domain = 'meet.jit.si';
        const options = {
          // Use user-defined roomName or generate a random one if empty
          roomName: roomName || `MyJitsiMeeting-${Math.random().toString(36).substr(2, 9)}`,
          width: '100%',
          height: '100%',
          parentNode: jitsiContainerRef.current,
          // Configuration overwrites
          configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableSimulcast: false,
            prejoinPageEnabled: false,
          },
          // UI interface overwrites
          interfaceConfigOverwrite: {
            SETTINGS_SECTIONS: ['devices', 'language', 'profile'],
            SHOW_CHROME_EXTENSION_BANNER: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY_WATERMARK: false,
            SHOW_PROMOTIONAL_CLOSE_PAGE: false,
            DEFAULT_BACKGROUND: '#2a2a2a',
            TOOLBAR_BUTTONS: [
              'microphone', 'camera', 'desktop', 'fullscreen',
              'fodeviceselection', 'hangup', 'chat', 'settings',
              'tileview', 'raisehand',
            ],
          },
          userInfo: {
            displayName: displayName || 'Guest',
          },
        };

        // Dispose existing instance before creating a new one
        if (jitsiApiRef.current) {
          try {
            jitsiApiRef.current.dispose();
          } catch (e) { /* ignore dispose error */ }
          jitsiApiRef.current = null;
        }

        const api = new window.JitsiMeetExternalAPI(domain, options);
        jitsiApiRef.current = api;
        didInit = true;

        // Event listener for when the user successfully joins the video conference
        api.on('videoConferenceJoined', () => {
          if (!isMountedRef.current) return;
          setIsLoading(false);
          try {
            api.executeCommand('displayName', displayName || 'Guest');
          } catch (err) { /* ignore */ }
        });

        // Event listener for when the user leaves the conference
        api.on('videoConferenceLeft', () => {
          if (!isMountedRef.current) return;
          try {
            jitsiApiRef.current?.dispose();
          } catch (e) { /* ignore */ }
          jitsiApiRef.current = null;
          setMeetingStarted(false); // Go back to the join form
        });

        // Event listener for general logging/debugging
        api.on('log', (data) => {
          if (data?.logLevel === 'error') {
            console.error('Jitsi API Error:', data.log);
          }
        });
      } catch (error) {
        console.error('Failed to initialize Jitsi Meet:', error);
        if (isMountedRef.current) {
          setIsLoading(false);
          setMeetingStarted(false);
        }
      }
    };

    initJitsi();

    // Cleanup: dispose Jitsi when meeting stops or component unmounts
    return () => {
      isMountedRef.current = false;
      if (didInit && jitsiApiRef.current) {
        try {
          jitsiApiRef.current.dispose();
        } catch (e) { /* ignore */ }
        jitsiApiRef.current = null;
      }
    };
  }, [scriptLoaded, meetingStarted, roomName, displayName]);

  // 3) Handlers for controls
  const handleStartMeeting = (e) => {
    e.preventDefault();
    if (displayName.trim()) {
      setMeetingStarted(true);
    } else {
      console.warn('Please enter your name.');
    }
  };

  const handleHangUp = () => {
    if (jitsiApiRef.current) {
      try {
        jitsiApiRef.current.executeCommand('hangup');
      } catch (e) {
        console.error('hangup command failed', e);
        setMeetingStarted(false);
      }
    }
  };

  const handleToggleMute = () => {
    jitsiApiRef.current?.executeCommand('toggleAudio');
  };

  const handleToggleVideo = () => {
    jitsiApiRef.current?.executeCommand('toggleVideo');
  };

  const handleToggleChat = () => {
    jitsiApiRef.current?.executeCommand('toggleChat');
  };

  // Embedded CSS for styling, replacing Tailwind utilities to ensure self-containment
  const customStyles = `
    /* Basic Reset */
    body { margin: 0; padding: 0; background-color: #1a1a1a; font-family: 'Inter', Arial, sans-serif; }
    
    /* Main Container */
    .app-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      color: white;
    }
    
    /* Header */
    .app-header {
      width: 100%;
      padding: 20px;
      background-color: #2a2a2a;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
    }
    .app-title {
      font-size: 28px;
      font-weight: bold;
      text-align: center;
      color: #4a90e2; /* Blue */
      letter-spacing: 1px;
    }
    .app-subtitle {
      font-size: 14px;
      text-align: center;
      color: #9e9e9e;
      margin-top: 5px;
    }
    
    /* Form Layout */
    .form-container {
      flex-grow: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 15px;
    }
    .app-form {
      width: 100%;
      max-width: 450px;
      background-color: #2a2a2a;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      border: 1px solid #3c3c3c;
    }
    .form-title {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 30px;
      text-align: center;
      color: #6aabff;
    }
    
    /* Form Inputs */
    .form-group {
      margin-bottom: 20px;
    }
    .form-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #ccc;
      margin-bottom: 8px;
    }
    .form-input {
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      background-color: #3c3c3c;
      color: white;
      border: 1px solid #5a5a5a;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .form-input:focus {
      border-color: #4a90e2;
      outline: none;
      box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.5);
    }

    /* Custom Button Styling (app-btn) */
    .app-btn {
      padding: 12px 20px;
      border-radius: 8px;
      font-weight: 600;
      color: white;
      transition: background-color 0.2s, transform 0.1s;
      border: none;
      cursor: pointer;
    }
    
    .app-btn-submit {
      width: 100%;
      background-color: #4a90e2;
      font-weight: bold;
      margin-top: 15px;
      padding: 15px 20px;
      font-size: 16px;
    }
    .app-btn-submit:hover:not(:disabled) {
      background-color: #3b74c0;
      transform: scale(1.01);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
    }
    .app-btn-submit:disabled {
      background-color: #5a5a5a;
      cursor: not-allowed;
    }

    /* Control Bar Buttons */
    .control-bar-container {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 15px;
    }
    
    .control-bar {
      width: 100%;
      max-width: 1000px;
      margin-top: 20px;
      padding: 15px;
      background-color: #2a2a2a;
      border-radius: 12px;
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 10px;
    }
    .control-bar .app-btn {
      background-color: #3c3c3c;
    }
    .control-bar .app-btn:hover {
      background-color: #5a5a5a;
    }
    .app-btn-hangup {
      background-color: #e74c3c; /* Red */
      font-weight: bold;
    }
    .app-btn-hangup:hover {
      background-color: #c0392b;
    }

    /* Meeting Interface */
    .jitsi-container {
      width: 100%;
      max-width: 1000px;
      background-color: #2a2a2a;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.5);
      flex-grow: 1;
      min-height: 500px;
      height: 80vh;
    }

    /* Loading Overlay */
    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: rgba(26, 26, 26, 0.95);
      z-index: 20;
      border-radius: 12px;
      text-align: center;
      color: white;
    }
    .loading-overlay .spinner-text {
        font-size: 20px;
        margin-bottom: 12px;
    }
    
    .loading-spinner {
      animation: spin 1s linear infinite;
      height: 32px;
      width: 32px;
      color: #4a90e2;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* Initial Loading State */
    .initial-loading {
        height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #1a1a1a;
        color: white;
        font-size: 20px;
    }
    .initial-loading .animate-pulse {
        animation: pulse 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
    }
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: .5; }
    }

    /* Responsiveness */
    @media (max-width: 768px) {
      .app-title { font-size: 24px; }
      .app-form { padding: 30px 20px; max-width: 100%; }
      .jitsi-container { min-height: 400px; height: 70vh; }
      .control-bar { gap: 8px; }
      .control-bar .app-btn { padding: 10px 15px; }
    }
  `;

  // 4) Render logic
  if (!scriptLoaded && !meetingStarted) {
    return (
      <div className="initial-loading">
        <div className="animate-pulse">Loading Jitsi API script...</div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Embedded CSS style block */}
      <style>{customStyles}</style>

      <header className="app-header">
        <h1 className="app-title">
          Jitsi Meet Video Bridge
        </h1>
        <p className="app-subtitle">
          {meetingStarted ? `Room: ${roomName || 'Auto-Generated'}` : 'Enter details to start a call.'}
        </p>
      </header>

      {/* Join Meeting Form (Visible when meetingStarted is false) */}
      {!meetingStarted ? (
        <div className="form-container">
          <form
            onSubmit={handleStartMeeting}
            className="app-form"
          >
            <h2 className="form-title">Start or Join a Meeting</h2>
            
            <div className="form-group">
              <label htmlFor="roomName" className="form-label">
                Room Identifier (Leave blank for random room)
              </label>
              <input
                type="text"
                id="roomName"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g., 'gemini-project-sync'"
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="displayName" className="form-label">
                Your Display Name <span style={{ color: '#e74c3c' }}>*</span>
              </label>
              <input
                type="text"
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g., 'Alex M.'"
                className="form-input"
                required
              />
            </div>
            
            <button
              type="submit"
              disabled={!displayName.trim()}
              className="app-btn app-btn-submit"
            >
              Start Meeting
            </button>
          </form>
        </div>
      ) : (
        // Meeting Interface (Visible when meetingStarted is true)
        <div className="control-bar-container">
          
          {/* Loading Overlay while joining */}
          {isLoading && (
            <div className="loading-overlay">
              <div className="spinner-text">Joining Meeting...</div>
              <svg className="loading-spinner" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
          )}

          {/* Jitsi Meet Container - flexible height using min-h */}
          <div
            ref={jitsiContainerRef}
            className="jitsi-container"
          >
            {/* Jitsi iframe will be injected here */}
          </div>

          {/* Custom Control Bar */}
          <div className="control-bar">
            <ControlButton onClick={handleToggleMute} label="Toggle Mute" />
            <ControlButton onClick={handleToggleVideo} label="Toggle Video" />
            <ControlButton onClick={handleToggleChat} label="Chat" />
            <ControlButton onClick={handleHangUp} label="End Call" className="app-btn-hangup" />
          </div>
        </div>
      )}
    </div>
  );
}