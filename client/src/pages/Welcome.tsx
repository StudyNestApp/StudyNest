import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { SERVER_URL } from '../lib/serverConfig';
import type { User } from '@supabase/supabase-js';
import CreateRoom from '../components/CreateRoom';

import VideoRoom from './VideoRoom';
import './../styles/Welcome.css';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

interface Room {
  creator: string;
  name: string;
  created_at: string;
  attendance: number;
  video_url?: string; // Add video_url field
}

interface ApiResponse {
  success: boolean;
  data: Room | Room[];
  count?: number;
  error?: string;
  message?: string;
}

function Welcome() {
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(dayjs());
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  
  // Video room states
  const [currentVideoRoom, setCurrentVideoRoom] = useState<Room | null>(null);
  const [showVideoRoom, setShowVideoRoom] = useState(false);

  // Extend dayjs with relative time plugin
  dayjs.extend(relativeTime);

  useEffect(() => {
    // Get current user
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };

    getCurrentUser();
  }, []);

  useEffect(() => {
    // Update current time every second for real-time relative time updates
    const timer = setInterval(() => {
      setCurrentTime(dayjs());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Fetch rooms from backend
    const fetchRooms = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/rooms`);
        const data: ApiResponse = await response.json();
        
        if (data.success && Array.isArray(data.data)) {
          setRooms(data.data);
        } else {
          setError(data.error || 'Failed to fetch rooms');
        }
      } catch (err) {
        setError('Failed to connect to server');
        console.error('Error fetching rooms:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRooms();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/'; // Redirect to auth form
  };

  // Handle room creation
  const handleRoomCreated = (newRoom: Room) => {
    // Add the new room to the beginning of the list
    setRooms(prevRooms => [newRoom, ...prevRooms]);
    console.log('Room created successfully:', newRoom);
  };

  // Open create room modal
  const handleCreateRoomClick = () => {
    setShowCreateRoom(true);
  };

  // Close create room modal
  const handleCloseCreateRoom = () => {
    setShowCreateRoom(false);
  };

  // Handle joining a room
  const handleJoinRoom = async (room: Room) => {
    if (!room.video_url) {
      setError('Room video URL not available');
      return;
    }

    try {
      // Join the room (increment attendance)
      const response = await fetch(`${SERVER_URL}/rooms/${room.name}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data: ApiResponse = await response.json();

      if (data.success && data.data && !Array.isArray(data.data)) {
        // Update local rooms state
        setRooms(prevRooms => 
          prevRooms.map(r => 
            r.name === room.name ? data.data as Room : r
          )
        );

        // Set current video room and show video interface
        setCurrentVideoRoom(data.data as Room);
        setShowVideoRoom(true);
      } else {
        setError(data.error || 'Failed to join room');
      }
    } catch (err) {
      console.error('Error joining room:', err);
      setError('Failed to join room');
    }
  };

  // Handle leaving video room
  const handleLeaveVideoRoom = async () => {
    if (!currentVideoRoom) return;

    try {
      // Try to leave the room (decrement attendance)
      // If room was deleted, this will fail gracefully
      const response = await fetch(`${SERVER_URL}/rooms/${currentVideoRoom.name}/leave`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data: ApiResponse = await response.json();

      if (data.success && data.data && !Array.isArray(data.data)) {
        // Update local rooms state
        setRooms(prevRooms => 
          prevRooms.map(r => 
            r.name === currentVideoRoom.name ? data.data as Room : r
          )
        );
      } else if (response.status === 404) {
        // Room was deleted, remove it from local state
        setRooms(prevRooms => 
          prevRooms.filter(r => r.name !== currentVideoRoom.name)
        );
      }
    } catch (err) {
      console.error('Error leaving room:', err);
      // If there's an error, try to refetch rooms to sync state
      try {
        const response = await fetch(`${SERVER_URL}/rooms`);
        const data: ApiResponse = await response.json();
        if (data.success && Array.isArray(data.data)) {
          setRooms(data.data);
        }
      } catch (refetchErr) {
        console.error('Error refetching rooms:', refetchErr);
      }
    } finally {
      // Always close video room UI
      setCurrentVideoRoom(null);
      setShowVideoRoom(false);
    }
  };

  const formatDate = (dateString: string) => {
    // Handle null, undefined, or empty strings
    if (!dateString) {
      return 'No date';
    }

    let date;
    // Check if it's a time-only string (HH:mm:ss format)
    const timeOnlyRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;
    if (timeOnlyRegex.test(dateString)) {
      // If it's just time, combine it with today's date for relative time calculation
      const today = dayjs().format('YYYY-MM-DD');
      const fullDateTimeString = `${today} ${dateString}`;
      date = dayjs(fullDateTimeString);
    } else {
      // Try to parse as a regular date/datetime
      date = dayjs(dateString);
    }

    // Check if the date is valid
    if (!date || !date.isValid()) {
      console.warn('Invalid date received:', dateString);
      return 'Invalid date';
    }

    // Return relative time that updates with currentTime state
    const relativeTime = date.from(currentTime);
    return `🕐 ${relativeTime}`;
  };

  // Show video room if user is in one
  if (showVideoRoom && currentVideoRoom && user) {
    return (
      <VideoRoom
        roomId={currentVideoRoom.video_url!} // Use video_url as room ID
        roomName={currentVideoRoom.name} // Pass room name for deletion
        user={user}
        onLeave={handleLeaveVideoRoom}
      />
    );
  }

  if (loading) {
    return (
      <div className="loading-container">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading rooms...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-container">
      <div className="main-wrapper">
        {/* Header Section */}
        <div className="header-card">
          <div className="header-content">
            <h1 className="welcome-title">
              Welcome, {user?.email?.split('@')[0] || 'User'}!
              <span style={{ color: 'initial' }}>👋</span>
            </h1>
            <p className="welcome-subtitle">Discover amazing study rooms and connect with fellow learners</p>
          </div>
          <button onClick={handleSignOut} className="sign-out-btn">
            Sign Out
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="error-message">
            <p className="error-text">⚠️ {error}</p>
            <button onClick={() => setError('')} className="error-close">✕</button>
          </div>
        )}

        {/* Rooms Section */}
        <div className="rooms-container">
          <div className="rooms-header">
            <div className="rooms-header-content">
              <h2 className="rooms-title">🎓 Study Rooms</h2>
              <div className="rooms-count">
                {rooms.length} room{rooms.length !== 1 ? 's' : ''} available
              </div>
            </div>
          </div>

          <div className="rooms-content">
            {rooms.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📚</div>
                <h3 className="empty-title">No study rooms yet</h3>
                <p className="empty-text">Be the pioneer and create the first study room!</p>
                <button className="empty-btn" onClick={handleCreateRoomClick}>
                  Create First Room 🚀
                </button>
              </div>
            ) : (
              <div className="rooms-table">
                <table className="table">
                  <thead className="table-header">
                    <tr>
                      <th>Room Name</th>
                      <th>Creator</th>
                      <th>Members</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rooms.map((room) => (
                      <tr key={room.name} className="table-row">
                        <td className="table-cell">
                          <div className="room-name-cell">
                            <div className="room-avatar">
                              {room.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="room-name">{room.name}</div>
                          </div>
                        </td>
                        <td className="table-cell">
                          <div className="creator-cell">
                            <div className="creator-avatar">
                              {room.creator.charAt(0).toUpperCase()}
                            </div>
                            <span className="creator-name">{room.creator}</span>
                          </div>
                        </td>
                        <td className="table-cell">
                          <span className="attendance-badge">
                            👥 {room.attendance} {room.attendance === 1 ? 'student' : 'students'}
                          </span>
                        </td>
                        <td className="table-cell">
                          <div className="date-cell">
                            <div className="date-text">📅 {formatDate(room.created_at)}</div>
                          </div>
                        </td>
                        <td className="table-cell">
                          <button 
                            className="join-btn"
                            onClick={() => handleJoinRoom(room)}
                            disabled={!room.video_url}
                          >
                            {room.video_url ? 'Join Room 🚀' : 'Room Not Ready'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <button className="action-btn create" onClick={handleCreateRoomClick}>
            <span>🏠</span>
            <span>Create New Room</span>
          </button>
        </div>
      </div>

      {/* Create Room Modal */}
      <CreateRoom
        user={user}
        isOpen={showCreateRoom}
        onClose={handleCloseCreateRoom}
        onRoomCreated={handleRoomCreated}
      />
    </div>
  );
}

export default Welcome;