import type { User } from '@supabase/supabase-js';

interface UserProfileData {
  userName: string;
  email?: string;
  roomsCreated: number;
  focusXP: number;
}

interface UserProfileModalProps {
  isOpen: boolean;
  profile: UserProfileData | null;
  currentUser: User | null;
  onClose: () => void;
}

const UserProfileModal = ({ isOpen, profile, currentUser, onClose }: UserProfileModalProps) => {
  if (!isOpen || !profile) {
    return null;
  }

  const isCurrentUser =
    !!currentUser?.email && currentUser.email.split('@')[0].toLowerCase() === profile.userName.toLowerCase();

  return (
    <div className="profile-modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal-header">
          <h3>User Profile</h3>
          <button className="profile-close-btn" onClick={onClose} aria-label="Close profile">
            ✕
          </button>
        </div>

        <div className="profile-main">
          <div className="profile-avatar">{profile.userName.charAt(0).toUpperCase()}</div>
          <div className="profile-identity">
            <div className="profile-name">{profile.userName}</div>
            <div className="profile-role">{isCurrentUser ? 'You' : 'StudyNest User'}</div>
            {profile.email && <div className="profile-email">{profile.email}</div>}
          </div>
        </div>

        <div className="profile-stats-grid">
          <div className="profile-stat-card">
            <span className="profile-stat-label">Rooms Created</span>
            <span className="profile-stat-value">{profile.roomsCreated}</span>
          </div>
          <div className="profile-stat-card">
            <span className="profile-stat-label">Focus XP</span>
            <span className="profile-stat-value">{profile.focusXP}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfileModal;
