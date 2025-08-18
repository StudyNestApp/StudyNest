import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import './../styles/Welcome.css';
import dayjs from 'dayjs';

interface Room {
  creator: string;
  name: string;
  created_at: string;
  attendance: number;
}

interface ApiResponse {
  success: boolean;
  data: Room[];
  count: number;
  error?: string;
  message?: string;
}

function Welcome() {
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Get current user
    const getCurrentUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };

    getCurrentUser();
  }, []);

  useEffect(() => {
    // Fetch rooms from backend
    const fetchRooms = async () => {
      try {
        const response = await fetch('http://localhost:5000/rooms');
        const data: ApiResponse = await response.json();
        
        if (data.success) {
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

  const formatDate = (dateString: string) => {
    return dayjs(dateString).format('MMM D, YYYY HH:mm');
  };


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

        {/* Statistics Cards */}
        <div className="stats-grid">
          <div className="stat-card teal">
            <div className="stat-content">
              <div>
                <p className="stat-text">Total Rooms</p>
                <p className="stat-number">{rooms.length}</p>
              </div>
              <div className="stat-icon">🏠</div>
            </div>
          </div>
          
          <div className="stat-card blue">
            <div className="stat-content">
              <div>
                <p className="stat-text">Active Students</p>
                <p className="stat-number">{rooms.reduce((sum, room) => sum + room.attendance, 0)}</p>
              </div>
              <div className="stat-icon">👥</div>
            </div>
          </div>
          
          <div className="stat-card purple">
            <div className="stat-content">
              <div>
                <p className="stat-text">Your Status</p>
                <p className="stat-number">Ready</p>
              </div>
              <div className="stat-icon">✨</div>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="error-message">
            <p className="error-text">⚠️ {error}</p>
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
                <button className="empty-btn">
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
                    {rooms.map((room, index) => {
                      console.log('Room created_at:', room.created_at); // log the raw value

                      return (
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
                            <button className="join-btn">Join Room 🚀</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <button className="action-btn create">
            <span>🏠</span>
            <span>Create New Room</span>
          </button>
          <button className="action-btn join">
            <span>🔗</span>
            <span>Join by Code</span>
          </button>
          <button className="action-btn browse">
            <span>🔍</span>
            <span>Browse All</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default Welcome;