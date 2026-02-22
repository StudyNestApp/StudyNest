import type { Room } from '../../types/rooms';

interface RoomsTableProps {
  rooms: Room[];
  onJoinRoom: (room: Room) => void;
  formatDate: (value: string) => string;
}

const RoomsTable = ({ rooms, onJoinRoom, formatDate }: RoomsTableProps) => (
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
                👥 {room.attendance}{' '}
                {room.attendance === 1 ? 'student' : 'students'}
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
                onClick={() => onJoinRoom(room)}
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
);

export default RoomsTable;
