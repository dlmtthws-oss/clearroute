import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function ImportHistoryPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('import_log')
        .select('id, total_rows, successful, skipped, failed, created_at')
        .order('created_at', { ascending: false });
      if (error) setError(error.message);
      else setLogs(data ?? []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/customers/import" className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Import History</h1>
          <p className="text-sm text-gray-500 mt-0.5">Record of all customer import runs</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <svg className="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading history…
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500">No imports yet</p>
          <Link to="/customers/import" className="mt-2 inline-block text-sm text-blue-600 hover:underline">
            Run your first import
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Rows</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Imported</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Skipped</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Failed</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map(log => {
                const date = new Date(log.created_at);
                const status = log.failed === 0 ? 'success' : log.successful > 0 ? 'partial' : 'failed';
                return (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-gray-700">
                      <span className="font-medium">{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      <span className="text-gray-400 ml-2 text-xs">{date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{log.total_rows?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-green-700 font-medium">{log.successful?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-yellow-600">{log.skipped?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-red-600">{log.failed?.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        status === 'success' ? 'bg-green-100 text-green-700' :
                        status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'
                      }`}>
                        {status === 'success' ? 'Complete' : status === 'partial' ? 'Partial' : 'Failed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
