import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { showSuccessToast, showErrorToast } from '../lib/errorHandling';
import { SkeletonCard } from '../components/SkeletonComponents';

export default function BankFeed({ user }) {
  const navigate = useNavigate();
  const [connections, setConnections] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState({});
  const [balances, setBalances] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showMatchModal, setShowMatchModal] = useState(null);
  const [showIgnoreModal, setShowIgnoreModal] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [matching, setMatching] = useState(false);

  const canManage = user?.role === 'admin';
  const canView = user?.role === 'admin' || user?.role === 'manager';

  useEffect(() => {
    if (!canView) return;
    loadConnections();
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  async function loadConnections() {
    const { data } = await supabase
      .from('bank_connections')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    
    setConnections(data || []);
    
    for (const conn of data || []) {
      fetchBalance(conn.id);
    }
  }

  async function loadTransactions() {
    const { data: conns } = await supabase
      .from('bank_connections')
      .select('id')
      .eq('user_id', user.id);
    
    if (!conns?.length) {
      setLoading(false);
      return;
    }

    const connIds = conns.map(c => c.id);
    let query = supabase
      .from('bank_transactions')
      .select('*, invoices(invoice_number), expenses(description)')
      .in('connection_id', connIds)
      .order('date', { ascending: false });

    const { data } = await query;
    setTransactions(data || []);
    setLoading(false);
  }

  async function fetchBalance(connectionId) {
    try {
      const { data, error } = await supabase.functions.invoke('truelayer-get-balance', {
        body: { connectionId }
      });
      
      if (!error && data) {
        setBalances(prev => ({ ...prev, [connectionId]: data }));
      }
    } catch (err) {
      console.error('Balance fetch error:', err);
    }
  }

  async function startAuth() {
    try {
      const { data, error } = await supabase.functions.invoke('truelayer-auth-start', {
        body: { userId: user.id }
      });
      
      if (error) throw error;
      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      showErrorToast('Connection Failed', 'Could not start bank connection. Please try again.');
    }
  }

  async function handleSync(connectionId) {
    setSyncing(prev => ({ ...prev, [connectionId]: true }));
    
    try {
      const { data, error } = await supabase.functions.invoke('truelayer-sync-transactions', {
        body: { connectionId, userId: user.id }
      });
      
      if (error) throw error;
      
      showSuccessToast('Sync Complete', `Imported ${data?.imported || 0} transactions`);
      loadTransactions();
      fetchBalance(connectionId);
    } catch (err) {
      showErrorToast('Sync Failed', 'Could not sync transactions. Please try again.');
    } finally {
      setSyncing(prev => ({ ...prev, [connectionId]: false }));
    }
  }

  async function handleDisconnect(connectionId) {
    if (!window.confirm('Are you sure you want to disconnect this bank account?')) return;
    
    await supabase.from('bank_connections').delete().eq('id', connectionId);
    loadConnections();
    loadTransactions();
    showSuccessToast('Disconnected', 'Bank account has been disconnected');
  }

  async function handleMatchToInvoice(transactionId, invoiceId) {
    setMatching(true);
    try {
      await supabase.rpc('match_bank_transaction_to_invoice', {
        p_transaction_id: transactionId,
        p_invoice_id: invoiceId,
        p_user_id: user.id
      });
      
      showSuccessToast('Matched', 'Transaction linked to invoice');
      setShowMatchModal(null);
      loadTransactions();
    } catch (err) {
      showErrorToast('Match Failed', 'Could not match transaction');
    } finally {
      setMatching(false);
    }
  }

  async function handleMatchToExpense(transactionId, expenseId) {
    setMatching(true);
    try {
      await supabase.rpc('match_bank_transaction_to_expense', {
        p_transaction_id: transactionId,
        p_expense_id: expenseId,
        p_user_id: user.id
      });
      
      showSuccessToast('Matched', 'Transaction linked to expense');
      setShowMatchModal(null);
      loadTransactions();
    } catch (err) {
      showErrorToast('Match Failed', 'Could not match transaction');
    } finally {
      setMatching(false);
    }
  }

  async function handleIgnore(transactionId, reason) {
    try {
      await supabase.rpc('ignore_bank_transaction', {
        p_transaction_id: transactionId,
        p_ignore_reason: reason,
        p_user_id: user.id
      });
      
      showSuccessToast('Ignored', 'Transaction has been ignored');
      setShowIgnoreModal(null);
      loadTransactions();
    } catch (err) {
      showErrorToast('Failed', 'Could not ignore transaction');
    }
  }

  async function handleUnmatch(transactionId) {
    if (!window.confirm('Are you sure you want to unmatch this transaction?')) return;
    
    try {
      await supabase.rpc('unmatch_bank_transaction', {
        p_transaction_id: transactionId,
        p_user_id: user.id
      });
      
      showSuccessToast('Unmatched', 'Transaction has been unmatched');
      loadTransactions();
    } catch (err) {
      showErrorToast('Failed', 'Could not unmatch transaction');
    }
  }

  async function loadSearchData(type) {
    if (type === 'invoice') {
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, customers(name), total, due_date, status')
        .in('status', ['sent', 'overdue'])
        .order('due_date', { ascending: false })
        .limit(20);
      setInvoices(data || []);
    } else {
      const { data } = await supabase
        .from('expenses')
        .select('id, description, amount, expense_date')
        .order('expense_date', { ascending: false })
        .limit(20);
      setExpenses(data || []);
    }
  }

  const filteredTransactions = transactions.filter(tx => {
    if (statusFilter !== 'all' && tx.reconciliation_status !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return tx.description?.toLowerCase().includes(q) || 
             tx.merchant_name?.toLowerCase().includes(q);
    }
    return true;
  });

  const summary = {
    unmatchedCredits: transactions.filter(tx => tx.reconciliation_status === 'unmatched' && tx.amount > 0).length,
    unmatchedDebits: transactions.filter(tx => tx.reconciliation_status === 'unmatched' && tx.amount < 0).length,
    matched: transactions.filter(tx => tx.reconciliation_status === 'matched').length,
    ignored: transactions.filter(tx => tx.reconciliation_status === 'ignored').length,
    totalUnmatchedCredits: transactions.filter(tx => tx.reconciliation_status === 'unmatched' && tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0),
    totalUnmatchedDebits: transactions.filter(tx => tx.reconciliation_status === 'unmatched' && tx.amount < 0).reduce((sum, tx) => sum + Math.abs(tx.amount), 0),
  };

  const formatTimeAgo = (date) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  if (!canView) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">You don't have access to bank feeds.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Bank Feed</h1>
          <p className="text-gray-600 text-sm">Connect your bank to auto-import transactions</p>
        </div>
        {canManage && (
          <button onClick={startAuth} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            + Connect Bank Account
          </button>
        )}
      </div>

      <p className="text-sm text-gray-500 mb-6">
        ClearRoute uses read-only access to your bank. We can never move money.
      </p>

      {/* Connected Accounts */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Connected Accounts</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : connections.length === 0 ? (
          <div className="bg-white rounded-lg border p-8 text-center">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            <p className="text-gray-500 mb-4">No bank accounts connected</p>
            {canManage && (
              <button onClick={startAuth} className="px-4 py-2 bg-blue-600 text-white rounded-lg">
                Connect Bank Account
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {connections.map(conn => (
              <div key={conn.id} className="bg-white rounded-lg border p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-medium">{conn.account_name}</h3>
                    <p className="text-sm text-gray-500">{conn.bank_name}</p>
                    <p className="text-xs text-gray-400">•••• {conn.account_number_last4}</p>
                  </div>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Connected</span>
                </div>
                
                <div className="text-sm mb-3">
                  <p className="text-gray-500">Balance</p>
                  <p className="text-xl font-semibold">
                    £{balances[conn.id]?.available?.toFixed(2) || '—'}
                  </p>
                </div>
                
                <div className="text-xs text-gray-400 mb-3">
                  Last synced: {formatTimeAgo(conn.last_synced_at)}
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleSync(conn.id)}
                    disabled={syncing[conn.id]}
                    className="flex-1 px-3 py-1.5 text-sm bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50"
                  >
                    {syncing[conn.id] ? 'Syncing...' : 'Sync Now'}
                  </button>
                  {canManage && (
                    <button 
                      onClick={() => handleDisconnect(conn.id)}
                      className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded"
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary Cards */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Unmatched Credits</p>
            <p className="text-xl font-bold text-green-600">{summary.unmatchedCredits}</p>
            <p className="text-xs text-gray-400">£{summary.totalUnmatchedCredits.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Unmatched Debits</p>
            <p className="text-xl font-bold text-red-600">{summary.unmatchedDebits}</p>
            <p className="text-xs text-gray-400">£{summary.totalUnmatchedDebits.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Matched</p>
            <p className="text-xl font-bold text-blue-600">{summary.matched}</p>
          </div>
          <div className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">Ignored</p>
            <p className="text-xl font-bold text-gray-600">{summary.ignored}</p>
          </div>
          {summary.unmatchedCredits === 0 && summary.unmatchedDebits === 0 && (
            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <p className="text-sm text-green-700">All matched!</p>
              <p className="text-lg font-bold text-green-600">✓</p>
            </div>
          )}
        </div>
      )}

      {/* Transaction Feed */}
      {transactions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Transactions</h2>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Search transactions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 border rounded-lg text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2 mb-4">
            {['all', 'unmatched', 'matched', 'ignored'].map(status => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-sm capitalize ${
                  statusFilter === status ? 'bg-gray-900 text-white' : 'bg-gray-100'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left p-3">Date</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-right p-3">Amount</th>
                  <th className="text-center p-3">Status</th>
                  <th className="text-left p-3">Matched To</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredTransactions.map(tx => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="p-3">{tx.date}</td>
                    <td className="p-3">
                      <p className="font-medium">{tx.description}</p>
                      {tx.merchant_name && <p className="text-xs text-gray-500">{tx.merchant_name}</p>}
                    </td>
                    <td className={`p-3 text-right font-medium ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.amount >= 0 ? '+' : ''}£{Math.abs(tx.amount).toFixed(2)}
                    </td>
                    <td className="p-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded ${
                        tx.reconciliation_status === 'matched' ? 'bg-green-100 text-green-700' :
                        tx.reconciliation_status === 'ignored' ? 'bg-gray-100 text-gray-600' :
                        tx.reconciliation_status === 'needs_review' ? 'bg-amber-100 text-amber-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>
                        {tx.reconciliation_status}
                      </span>
                    </td>
                    <td className="p-3">
                      {tx.matched_invoice_id ? (
                        <button 
                          onClick={() => navigate(`/invoices/${tx.matched_invoice_id}`)}
                          className="text-blue-600 hover:underline"
                        >
                          {tx.invoices?.invoice_number}
                        </button>
                      ) : tx.matched_expense_id ? (
                        <span className="text-gray-600">{tx.expenses?.description}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {tx.reconciliation_status === 'unmatched' ? (
                        <div className="flex gap-1 justify-end">
                          {tx.amount > 0 ? (
                            <button 
                              onClick={() => { setShowMatchModal({ type: 'invoice', transactionId: tx.id }); loadSearchData('invoice'); }}
                              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              Match Invoice
                            </button>
                          ) : (
                            <button 
                              onClick={() => { setShowMatchModal({ type: 'expense', transactionId: tx.id }); loadSearchData('expense'); }}
                              className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              Match Expense
                            </button>
                          )}
                          <button 
                            onClick={() => setShowIgnoreModal(tx.id)}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                          >
                            Ignore
                          </button>
                        </div>
                      ) : tx.reconciliation_status === 'matched' ? (
                        <button 
                          onClick={() => handleUnmatch(tx.id)}
                          className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                        >
                          Unmatch
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Match Modal */}
      {showMatchModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[80vh] overflow-auto">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="font-semibold">
                Match to {showMatchModal.type === 'invoice' ? 'Invoice' : 'Expense'}
              </h3>
              <button onClick={() => setShowMatchModal(null)} className="text-gray-500">✕</button>
            </div>
            <div className="p-4">
              {showMatchModal.type === 'invoice' ? (
                invoices.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No invoices available to match</p>
                ) : (
                  <div className="space-y-2">
                    {invoices.map(inv => (
                      <button
                        key={inv.id}
                        onClick={() => handleMatchToInvoice(showMatchModal.transactionId, inv.id)}
                        disabled={matching}
                        className="w-full p-3 text-left border rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        <p className="font-medium">{inv.invoice_number}</p>
                        <p className="text-sm text-gray-500">{inv.customers?.name}</p>
                        <p className="text-sm">£{inv.total} • Due {inv.due_date}</p>
                      </button>
                    ))}
                  </div>
                )
              ) : (
                expenses.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No expenses available to match</p>
                ) : (
                  <div className="space-y-2">
                    {expenses.map(exp => (
                      <button
                        key={exp.id}
                        onClick={() => handleMatchToExpense(showMatchModal.transactionId, exp.id)}
                        disabled={matching}
                        className="w-full p-3 text-left border rounded hover:bg-gray-50 disabled:opacity-50"
                      >
                        <p className="font-medium">{exp.description}</p>
                        <p className="text-sm">£{exp.amount} • {exp.expense_date}</p>
                      </button>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Ignore Modal */}
      {showIgnoreModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-sm w-full">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Ignore Transaction</h3>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-600 mb-4">Why are you ignoring this transaction?</p>
              {['personal', 'withdrawal', 'transfer', 'already_recorded', 'other'].map(reason => (
                <button
                  key={reason}
                  onClick={() => handleIgnore(showIgnoreModal, reason)}
                  className="w-full p-2 text-left text-sm border rounded hover:bg-gray-50 mb-2 capitalize"
                >
                  {reason.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}