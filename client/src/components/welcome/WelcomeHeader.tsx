interface WelcomeHeaderProps {
  userName: string;
  onSignOut: () => void;
}

const WelcomeHeader = ({ userName, onSignOut }: WelcomeHeaderProps) => (
  <div className="header-card">
    <div className="header-content">
      <h1 className="welcome-title">
        Welcome, {userName}!
        <span style={{ color: 'initial' }}>👋</span>
      </h1>
      <p className="welcome-subtitle">
        Discover amazing study rooms and connect with fellow learners
      </p>
    </div>
    <button onClick={onSignOut} className="sign-out-btn">
      Sign Out
    </button>
  </div>
);

export default WelcomeHeader;
