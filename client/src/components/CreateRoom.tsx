import { useState } from 'react';
import type { User } from '@supabase/supabase-js';
import './../styles/CreateRoom.css';

interface Room {
  creator: string;
  name: string;
  created_at: string;
  attendance: number;
}

interface CreateRoomProps {
  user: User | null;
  onRoomCreated: (room: Room) => void;
  onClose: () => void;
  isOpen: boolean;
}

interface ApiResponse {
  success: boolean;
  data?: Room;
  error?: string;
  message?: string;
}

function CreateRoom({ user, onRoomCreated, onClose, isOpen }: CreateRoomProps) {
  const [roomName, setRoomName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!roomName.trim()) {
      setError('Room name is required');
      return;
    }

    if (!user?.email) {
      setError('User authentication required');
      return;
    }

    setLoading(true);
    setError('');

    const requestData = {
      creator: user.email.split('@')[0],
      name: roomName.trim(),
      attendance: 1, // Creator starts as first member
    };

    // Debug logging
    console.log('Sending request data:', requestData);

    try {
      const response = await fetch('http://localhost:5000/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
      });

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      const data: ApiResponse = await response.json();
      console.log('Response data:', data);

      if (data.success && data.data) {
        onRoomCreated(data.data);
        setRoomName('');
        onClose();
      } else {
        setError(data.error || 'Failed to create room');
      }
    } catch (err) {
      console.error('Full error details:', err);
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRoomName('');
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">🏠 Create New Study Room</h2>
          <button 
            onClick={handleClose}
            className="close-btn"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="create-room-form">
          <div className="form-group">
            <label htmlFor="roomName" className="form-label">
              Room Name <span className="required">*</span>
            </label>
            <input
              type="text"
              id="roomName"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="Enter a unique room name..."
              className={`form-input ${error ? 'error' : ''}`}
              maxLength={50}
              disabled={loading}
            />
            <div className="form-help">
              Choose a descriptive name that others can easily find
            </div>
          </div>

          {error && (
            <div className="error-message">
              <span className="error-icon">⚠️</span>
              <span className="error-text">{error}</span>
            </div>
          )}

          <div className="creator-info">
            <div className="creator-label">Creator:</div>
            <div className="creator-display">
              <div className="creator-avatar">
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <span className="creator-name">
                {user?.email?.split('@')[0] || 'Unknown User'}
              </span>
            </div>
          </div>

          <div className="form-actions">
            <button
              type="button"
              onClick={handleClose}
              className="cancel-btn"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="create-btn"
              disabled={loading || !roomName.trim()}
            >
              {loading ? (
                <>
                  <span className="loading-spinner"></span>
                  Creating...
                </>
              ) : (
                <>
                  <span>🚀</span>
                  Create Room
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateRoom;