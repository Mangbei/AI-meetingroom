import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.tsx'
import NewDebate from './pages/NewDebate.tsx'
import DebateView from './pages/DebateView.tsx'
import NewMeeting from './pages/NewMeeting.tsx'
import MeetingView from './pages/MeetingView.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewDebate />} />
      <Route path="/debates/:id" element={<DebateView />} />
      <Route path="/meetings/new" element={<NewMeeting />} />
      <Route path="/meetings/:id" element={<MeetingView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
