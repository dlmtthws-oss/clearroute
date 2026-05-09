import { Link } from 'react-router-dom'

export default function Settings({ user }) {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link to="/invite" className="p-6 bg-white rounded-lg shadow hover:shadow-md transition-shadow">
          <div className="text-2xl mb-2">✉️</div>
          <h3 className="font-semibold">Invite Users</h3>
          <p className="text-sm text-gray-600">Invite team members to use ClearRoute</p>
        </Link>
      </div>
    </div>
  )
}
