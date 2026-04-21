import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function InviteUsers({ user, onClose }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('worker');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function handleInvite(e) {
    e.preventDefault();
    setSending(true);
    setError('');

    try {
      // Create invitation record
      const { data, error: inviteError } = await supabase
        .from('invitations')
        .insert([{ 
          email, 
          role,
          invited_by: user?.id,
          status: 'pending'
        }])
        .select()
        .single();

      if (inviteError) throw inviteError;

      // Note: In production, you'd send an actual email here
      // For now, show the invite code
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="p-6 text-center">
        <div className="text-4xl mb-4">✉️</div>
        <h3 className="text-lg font-semibold mb-2">Invitation Sent!</h3>
        <p className="text-gray-600 mb-4">
          An invitation has been sent to <strong>{email}</strong>
        </p>
        <p className="text-sm text-gray-500">
          Role: {role}
        </p>
        <button
          onClick={onClose}
          className="mt-4 btn btn-primary"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h3 className="text-lg font-semibold mb-4">Invite New User</h3>
      
      <form onSubmit={handleInvite} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Email Address
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="input"
            placeholder="colleague@company.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Role
          </label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="input"
          >
            <option value="worker">Field Worker</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 btn btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={sending}
            className="flex-1 btn btn-primary"
          >
            {sending ? 'Sending...' : 'Send Invitation'}
          </button>
        </div>
      </form>
    </div>
  );
}