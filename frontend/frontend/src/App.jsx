import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import AdminDashboard from './pages/AdminDashboard';
import PlayerView from './pages/PlayerView';
import AudienceView from './pages/AudienceView';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/play" element={<PlayerView />} />
        <Route path="/screen" element={<AudienceView />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
