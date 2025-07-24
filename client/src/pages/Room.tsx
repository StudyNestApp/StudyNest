import { useParams } from "react-router-dom";

export default function Room() {
  // Grab the room ID from the URL params
  const { id } = useParams<{ id: string }>();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-bold mb-4">Welcome to Room: {id}</h1>

      {/* Placeholder for video area */}
      <div className="w-full max-w-4xl h-96 bg-black rounded-md flex items-center justify-center text-white">
        <p className="text-lg">Video stream will appear here</p>
      </div>

      {/* Placeholder for controls */}
      <div className="mt-6 flex space-x-4">
        <button className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50" disabled>
          Mute (disabled on join)
        </button>
        <button className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400">
          Leave Room
        </button>
      </div>
    </div>
  );
}
