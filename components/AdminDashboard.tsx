
import React, { useState, useEffect } from 'react';
import { getAllUsers, initializeUser, updateUserStatus, updateUserRole, deleteUserFully, batchUploadMarketData, createOrUpdateDailyWatchlist, getDailyWatchlist } from '../services/supabaseService';
import { UserMetadata } from '../types';
import { supabase } from '../services/supabase';
import * as XLSX from 'xlsx';

const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Market Data State
  const [selectedMarket, setSelectedMarket] = useState('SP500');
  const [uploadingMarket, setUploadingMarket] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [creatingWatchlist, setCreatingWatchlist] = useState(false);
  const [dailyWatchlistSymbols, setDailyWatchlistSymbols] = useState('');
  const [todayWatchlist, setTodayWatchlist] = useState<string[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data.user);
    });
  }, []);

  useEffect(() => {
    getDailyWatchlist().then((w) => {
      if (w) setTodayWatchlist(w.symbols);
    });
  }, [creatingWatchlist]);

  const fetchUsers = async (forceRefresh = false) => {
    if (forceRefresh) setIsSyncing(true);
    setLoading(true);
    setError(null);
    try {
      let data = await getAllUsers();
      if (data.length === 0 && currentUser) {
        await initializeUser(
          currentUser.id,
          currentUser.email ?? null,
          currentUser.user_metadata?.full_name ?? currentUser.email?.split('@')[0] ?? null
        );
        data = await getAllUsers();
      }
      setUsers(data);
    } catch (err: any) {
      console.error("AdminDashboard: Access Error:", err);
      let errorMessage = "Access Denied.";
      if (err.code === 'permission-denied') {
        errorMessage = `Security Policy Restriction: Access for ${currentUser?.email} was rejected by Cloud Rules.`;
      } else {
        errorMessage = err.message || "An internal error occurred during data retrieval.";
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    if (currentUser) fetchUsers();
  }, [currentUser]);

  // Exclude current user from the list so admin only sees other users
  const otherUsers = users.filter((u) => u.uid !== currentUser?.id);

  const showFeedback = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  // --- Market Data Upload Logic ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const processExcel = async () => {
    if (!file) return alert("Please select an Excel file first.");
    setUploadingMarket(true);
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(sheet);

        const assetsToUpload: { symbol: string, name: string }[] = [];

        // Map columns flexibly
        jsonData.forEach((row: any) => {
          // Check various common column names
          const symbol = row['Ticker'] || row['Symbol'] || row['symbol'] || row['ticker'];
          const name = row['Name'] || row['Company'] || row['name'] || row['company'];

          if (symbol && name) {
            assetsToUpload.push({
              symbol: String(symbol).toUpperCase().trim(),
              name: String(name).trim()
            });
          }
        });

        if (assetsToUpload.length === 0) {
          throw new Error("No valid data found. Ensure columns are named 'Ticker' and 'Name'.");
        }

        console.log(`Uploading ${assetsToUpload.length} entries to ${selectedMarket}...`);
        await batchUploadMarketData(selectedMarket, assetsToUpload);
        showFeedback(`Successfully uploaded ${assetsToUpload.length} assets to ${selectedMarket} database.`);
        setFile(null);
        // Reset file input value
        const fileInput = document.getElementById('excel-upload') as HTMLInputElement;
        if (fileInput) fileInput.value = "";

      } catch (err: any) {
        console.error("Upload failed", err);
        setError("Upload Failed: " + err.message);
      } finally {
        setUploadingMarket(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };


  // --- User Management Logic ---

  const handleToggleStatus = async (uid: string, currentStatus: string) => {
    if (uid === currentUser?.id) return alert("You cannot suspend yourself.");
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await updateUserStatus(uid, newStatus as 'active' | 'disabled');
      setUsers(users.map(u => u.uid === uid ? { ...u, status: newStatus as 'active' | 'disabled' } : u));
      showFeedback(newStatus === 'disabled' ? "User suspended." : "User activated.");
    } catch (err: any) {
      setError("Failed to update status: " + err.message);
    }
  };

  const handleRoleChange = async (uid: string, currentRole: string) => {
    if (uid === currentUser?.id) return alert("System Integrity Check: Self-role modification is disabled for security.");
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await updateUserRole(uid, newRole as 'user' | 'admin');
      setUsers(users.map(u => u.uid === uid ? { ...u, role: newRole as 'user' | 'admin' } : u));
      showFeedback(`User role escalated to ${newRole.toUpperCase()}`);
    } catch (err: any) {
      setError("Role modification failed: " + err.message);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (uid === currentUser?.id) return alert("You cannot delete yourself.");
    if (!window.confirm("Permanently delete this user? They will be removed from the system and must sign up again to use the app. This cannot be undone.")) return;

    try {
      const result = await deleteUserFully(uid);
      setUsers(users.filter(u => u.uid !== uid));
      showFeedback(
        result.permanent !== false
          ? "User deleted. They must sign up again to use the app."
          : "User removed from list. They can still sign in until the delete-user Edge Function is reachable (check VITE_SUPABASE_URL and deploy the function)."
      );
    } catch (err: any) {
      setError("Delete failed: " + (err?.message ?? String(err)));
    }
  };

  /** Create or update watchlist of the day — only manager can create; all users can see it. */
  const handleCreateWatchlistOfToday = async () => {
    if (!currentUser?.id) return;
    const symbols = dailyWatchlistSymbols.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (symbols.length === 0) {
      setError("Enter at least one symbol (comma or newline separated).");
      return;
    }
    setCreatingWatchlist(true);
    setError(null);
    try {
      await createOrUpdateDailyWatchlist(currentUser.id, symbols);
      setTodayWatchlist(symbols.map(s => s.toUpperCase()));
      setDailyWatchlistSymbols('');
      showFeedback("Today's watchlist saved. All users can see it on the Dashboard.");
    } catch (err: any) {
      setError(err?.message || "Watchlist creation failed.");
    } finally {
      setCreatingWatchlist(false);
    }
  };

  const handleWipeRegistry = async () => {
    const uidsToPurge = users.filter(u => u.uid !== currentUser?.id).map(u => u.uid);
    if (uidsToPurge.length === 0) return alert("Registry is already clean (excluding your master account).");

    const firstConfirm = window.confirm(`NUCLEAR OPTION: You are about to purge ${uidsToPurge.length} identity records from Auth and Database. This action is irreversible. Continue?`);
    if (!firstConfirm) return;

    const secondConfirm = window.prompt("To proceed with the total registry wipe, please type: PURGE ALL DATA");
    if (secondConfirm !== "PURGE ALL DATA") return alert("Verification failed. Wipe sequence aborted.");

    setIsPurging(true);
    try {
      for (const uid of uidsToPurge) {
        await deleteUserFully(uid);
      }
      setUsers(users.filter(u => u.uid === currentUser?.id));
      showFeedback("Institutional registry has been purged.");
    } catch (err: any) {
      setError("Bulk purge failed: " + err.message);
    } finally {
      setIsPurging(false);
    }
  };

  if (loading && !isSyncing) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-12 h-12 border-4 border-slate-200 border-t-indigo-600 rounded-full animate-spin"></div>
        <p className="mt-4 text-slate-500 font-bold text-xs uppercase tracking-widest animate-pulse">Establishing Secure Socket...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 text-9xl">🛡️</div>
        <div className="relative z-10">
          <h2 className="text-3xl font-black tracking-tight">System Authority</h2>
          <p className="text-slate-400 mt-2 max-w-lg font-medium">Root-level directory for institutional identity management and network oversight.</p>
        </div>
        <div className="relative z-10 mt-6 md:mt-0">
          <button
            onClick={() => fetchUsers(true)}
            disabled={isSyncing}
            className="group flex items-center space-x-3 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
          >
            <span className={isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}>🔄</span>
            <span>{isSyncing ? 'Authorizing...' : 'Sync Registry'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 p-6 rounded-3xl animate-in fade-in slide-in-from-top-4 duration-500 shadow-xl shadow-rose-900/5">
          <h4 className="font-bold text-rose-900 text-lg">Operation Failed</h4>
          <p className="text-rose-600 text-sm font-medium mt-1">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 p-4 rounded-2xl text-center font-bold text-sm animate-in fade-in duration-300">
          ✓ {success}
        </div>
      )}

      {/* --- MARKET DATA UPLOAD SECTION --- */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Market Data Ingestion</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">Upload Excel sheets (.xlsx) to populate market databases.</p>
          </div>
          <div className="text-3xl opacity-20">📊</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end bg-slate-50 p-6 rounded-2xl border border-slate-200/60">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Database</label>
            <select
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
              className="w-full px-5 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            >
              <option value="SP500">S&P 500</option>
              <option value="NASDAQ">Nasdaq</option>
              <option value="ASIA">Asian Markets</option>
              <option value="CRYPTO">Cryptocurrency</option>
              <option value="COMMODITY">Commodities</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Source File (.xlsx)</label>
            <input
              id="excel-upload"
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileChange}
              className="w-full text-xs file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-black file:uppercase file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 text-slate-500 font-medium cursor-pointer"
            />
          </div>

          <button
            onClick={processExcel}
            disabled={uploadingMarket || !file}
            className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {uploadingMarket ? 'Ingesting Data...' : 'Process & Upload'}
          </button>
        </div>
        <p className="mt-4 text-[10px] text-slate-400 font-medium italic">* File must contain columns named "Ticker" and "Name".</p>
      </div>

      {/* Create watchlist of today — only manager can create; all users can see it */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-8 relative overflow-hidden">
        <div className="space-y-4">
          <div>
            <h3 className="font-bold text-slate-900 uppercase tracking-widest text-sm">Today&apos;s watchlist</h3>
            <p className="text-xs text-slate-400 font-bold mt-1">Create a watchlist for today. All logged-in users can see it (read-only).</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Symbols (comma or newline separated)</label>
              <textarea
                value={dailyWatchlistSymbols}
                onChange={(e) => setDailyWatchlistSymbols(e.target.value)}
                placeholder="e.g. AAPL, MSFT, GOOGL"
                rows={2}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>
            <button
              onClick={handleCreateWatchlistOfToday}
              disabled={creatingWatchlist || !dailyWatchlistSymbols.trim()}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {creatingWatchlist ? 'Saving...' : "Save today's watchlist"}
            </button>
          </div>
          {todayWatchlist.length > 0 && (
            <p className="text-xs text-slate-500 font-medium">
              Current today&apos;s list: <span className="font-bold text-slate-700">{todayWatchlist.join(', ')}</span>
            </p>
          )}
        </div>
      </div>

      {!error && (
        <>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 bg-slate-50/30">
              <h3 className="font-bold text-slate-800 uppercase tracking-widest text-xs">Other users ({otherUsers.length})</h3>
              <p className="text-slate-500 text-xs mt-1 font-medium">Manage other users. You are not shown in this list.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/20">
                    <th className="px-8 py-5">User</th>
                    <th className="px-8 py-5">Role</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {otherUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-8 py-12 text-center text-slate-500 text-sm font-medium">
                        No other users in registry. Use &quot;Sync Registry&quot; to pull in new sign-ups, or ensure the profiles table and RLS are set up (see supabase-profiles-table.sql).
                      </td>
                    </tr>
                  ) : (
                    otherUsers.map(user => (
                      <tr key={user.uid} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-8 py-5">
                          <div className="flex items-center space-x-4">
                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm border-2 ${user.role === 'admin' ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                              }`}>
                              {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">{user.displayName || 'Anonymous'}</p>
                              <p className="text-xs text-slate-400 font-medium">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <button
                            onClick={() => handleRoleChange(user.uid, user.role)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${user.role === 'admin'
                              ? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
                              : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-100'
                              }`}
                          >
                            {user.role}
                          </button>
                        </td>
                        <td className="px-8 py-5">
                          <button
                            onClick={() => handleToggleStatus(user.uid, user.status)}
                            className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${user.status === 'active'
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100'
                              }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${user.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                            {user.status === 'active' ? 'Active' : 'Suspended'}
                          </button>
                          <span className="block mt-1 text-[9px] text-slate-400 font-medium">
                            {user.status === 'active' ? 'Click to suspend' : 'Click to activate'}
                          </span>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <button
                            onClick={() => handleDeleteUser(user.uid)}
                            title="Delete this user"
                            className="inline-flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all text-xs font-bold uppercase tracking-wider"
                          >
                            <span aria-hidden>🗑️</span>
                            <span>Delete</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* DANGER ZONE */}
          <div className="bg-rose-50 border border-rose-100 p-8 rounded-3xl mt-12 overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4 opacity-5 text-8xl grayscale">☢️</div>
            <div className="relative z-10">
              <h3 className="text-rose-900 font-black text-xs uppercase tracking-[0.2em] mb-4">Institutional Risk Protocol (Danger Zone)</h3>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="max-w-xl">
                  <p className="text-rose-800 font-bold text-lg leading-tight">Wipe Institutional Registry</p>
                  <p className="text-rose-600 text-xs mt-2 font-medium leading-relaxed">
                    This directive will permanently purge all cloud asset data and identity metadata for every user in the database, excluding your own master account. This action cannot be undone.
                  </p>
                </div>
                <button
                  onClick={handleWipeRegistry}
                  disabled={isPurging || otherUsers.length === 0}
                  className={`px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl ${isPurging || otherUsers.length === 0
                    ? 'bg-rose-200 text-rose-400 cursor-not-allowed'
                    : 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-900/10'
                    }`}
                >
                  {isPurging ? 'Purging Registry...' : 'Wipe All Identities'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
