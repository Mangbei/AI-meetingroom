import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.tsx'
import NewMeeting from './pages/NewMeeting.tsx'
import AgendaReview from './pages/AgendaReview.tsx'
import MeetingView from './pages/MeetingView.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/meetings/new" element={<NewMeeting />} />
      <Route path="/meetings/agenda-review/:draftId" element={<AgendaReview />} />
      <Route path="/meetings/:id" element={<MeetingView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
