// LAN: API uses the same hostname as the page, with Backend on port 3000.
// For a public deployment, set VITE_API_URL in the hosting environment.
export const API_URL = (import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3000`).replace(/\/$/, '');
