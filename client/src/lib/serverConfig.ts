// Get the correct server URL based on the current hostname
export const getServerUrl = (): string => {
  const protocol = window.location.protocol; // Use same protocol as frontend
  const host = window.location.hostname;
  const port = 5000;
  
  // Match frontend protocol (https for secure, http for local)
  return `${protocol}//${host}:${port}`;
};

export const SERVER_URL = getServerUrl();

