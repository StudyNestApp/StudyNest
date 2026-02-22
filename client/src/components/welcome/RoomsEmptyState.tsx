interface RoomsEmptyStateProps {
  onCreateRoom: () => void;
}

const RoomsEmptyState = ({ onCreateRoom }: RoomsEmptyStateProps) => (
  <div className="empty-state">
    <div className="empty-icon">📚</div>
    <h3 className="empty-title">No study rooms yet</h3>
    <p className="empty-text">Be the pioneer and create the first study room!</p>
    <button className="empty-btn" onClick={onCreateRoom}>
      Create First Room 🚀
    </button>
  </div>
);

export default RoomsEmptyState;
