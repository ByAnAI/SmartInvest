import React, { useState, useEffect } from 'react';
import { getAllUsers, updateUserStatus, updateUserRole, deleteUserRecord, purgeUsers } from '../services/firestoreService';
import { UserMetadata } from '../types';
import { auth } from '../services/firebase';

const AdminDashboard: React.FC = () => {
  const [users, setUsers] = useState<UserMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const currentUser = auth.currentUser;

  const fetchUsers = async (forceRefresh = false) => {
    if (forceRefresh) setIsSyncing(true);
    setLoading(true);
    setError(null);
    try {
      console.log("AdminDashboard: Initializing synchronization sequence...");
      
      // If forceRefresh is requested, we force Firebase to refresh the user's ID token.
      // This is CRITICAL if security rules were just updated, as it refreshes the token claims.
      if (forceRefresh && auth.currentUser) {
        console.log("AdminDashboard: Forcing Auth Token Refresh (claims update)...");
        await auth.currentUser.getIdToken(true);
      }
      
      const data = await getAllUsers();
      console.log(`AdminDashboard: Registry sync complete. Found ${data.length} records.`);
      setUsers(data);
    } catch (err: any) {
      console.error("AdminDashboard: Access Error:", err);
      
      let errorMessage = "Access Denied.";
      if (err.code === 'permission-denied') {
        errorMessage = `Security Policy Restriction: Access for ${currentUser?.email} was rejected by Cloud Rules. 
        
        If you are the Master Admin, please:
        1. Click 'Force Registry Sync' below to refresh your token.
        2. If that fails, log out and log back in.
        3. Ensure your email is verified.`;
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
    fetchUsers();
  }, []);

  const showFeedback = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleToggleStatus = async (uid: string, currentStatus: string) => {
    if (uid === currentUser?.uid) return alert("System Integrity Check: You cannot disable your own primary administrative session.");
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      await updateUserStatus(uid, newStatus as 'active' | 'disabled');
      setUsers(users.map(u => u.uid === uid ? { ...u, status: newStatus as 'active' | 'disabled' } : u));
      showFeedback(`Investor status set to ${newStatus.toUpperCase()}`);
    } catch (err: any) {
      setError("Administrative command failed: " + err.message);
    }
  };

  const handleRoleChange = async (uid: string, currentRole: string) => {
    if (uid === currentUser?.uid) return alert("System Integrity Check: Self-role modification is disabled for security.");
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
    if (uid === currentUser?.uid) return alert("System Integrity Check: Self-purging is prohibited.");
    if (!window.confirm("CRITICAL WARNING: Permanently delete this investor record? This action is recorded in the system audit logs.")) return;
    
    try {
      await deleteUserRecord(uid);
      setUsers(users.filter(u => u.uid !== uid));
      showFeedback("Identity purged from the registry.");
    } catch (err: any) {
      setError("Purge operation failed: " + err.message);
    }
  };

  const handleWipeRegistry = async () => {
    const uidsToPurge = users.filter(u => u.uid !== currentUser?.uid).map(u => u.uid);
    if (uidsToPurge.length === 0) return alert("Registry is already clean (excluding your master account).");

    const firstConfirm = window.confirm(`NUCLEAR OPTION: You are about to purge ${uidsToPurge.length} identity records from the database. This action is irreversible. Continue?`);
    if (!firstConfirm) return;

    const secondConfirm = window.prompt("To proceed with the total registry wipe, please type: PURGE ALL DATA");
    if (secondConfirm !== "PURGE ALL DATA") return alert("Verification failed. Wipe sequence aborted.");

    setIsPurging(true);
    try {
      await purgeUsers(uidsToPurge);
      setUsers(users.filter(u => u.uid === currentUser?.uid));
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
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-slate-900 p-8 rounded-3xl text-white shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5 text-9xl">🛡️</div>
        <div className="relative z-10">
          <h2 className="text-3xl font-black tracking-tight">System Authority</h2>
          <p className="text-slate-400 mt-2 max-w-lg font-medium">Root-level directory for institutional identity management and network oversight.</p>
          <div className="mt-4 flex items-center space-x-2 text-[10px] text-indigo-400 font-bold uppercase tracking-widest bg-white/5 w-fit px-3 py-1 rounded-full border border-white/5">
            <span>Logged as:</span>
            <span className="text-white">{currentUser?.email}</span>
          </div>
        </div>
        <div className="relative z-10 mt-6 md:mt-0">
          <button 
            onClick={() => fetchUsers(true)}
            disabled={isSyncing}
            className="group flex items-center space-x-3 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
          >
            <span className={isSyncing ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}>🔄</span>
            <span>{isSyncing ? 'Authorizing Token...' : 'Force Registry Sync'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-100 p-8 rounded-3xl animate-in fade-in slide-in-from-top-4 duration-500 shadow-xl shadow-rose-900/5">
          <div className="flex items-start space-x-4">
            <div className="text-5xl">🚫</div>
            <div className="flex-1">
              <h4 className="font-bold text-rose-900 text-xl">Identity Verification Failure</h4>
              <p className="text-rose-600 text-sm font-medium mt-2 leading-relaxed whitespace-pre-line">{error}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button 
                  onClick={() => fetchUsers(true)}
                  className="bg-rose-600 text-white px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-rose-700 transition-all shadow-lg shadow-rose-900/20 active:scale-95"
                >
                  Retry Authorization
                </button>
                <button 
                  onClick={() => auth.signOut()}
                  className="bg-white border border-rose-200 text-rose-600 px-6 py-3 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-rose-50 transition-all"
                >
                  Log Out / Refresh Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 p-4 rounded-2xl text-center font-bold text-sm animate-in fade-in duration-300">
          ✓ Directive Processed Successfully
        </div>
      )}

      {!error && (
        <>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 uppercase tracking-widest text-xs">Identity Registry ({users.length})</h3>
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Firestore Stream</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 bg-slate-50/20">
                    <th className="px-8 py-5">Identity Profile</th>
                    <th className="px-8 py-5">System Role</th>
                    <th className="px-8 py-5">Current Status</th>
                    <th className="px-8 py-5">Last Activity</th>
                    <th className="px-8 py-5 text-right">Directives</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map(user => (
                    <tr key={user.uid} className={`hover:bg-slate-50/50 transition-colors ${user.uid === currentUser?.uid ? 'bg-indigo-50/30' : ''}`}>
                      <td className="px-8 py-5">
                        <div className="flex items-center space-x-4">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm border-2 ${
                            user.role === 'admin' ? 'bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-100' : 'bg-slate-50 text-slate-400 border-slate-100'
                          }`}>
                            {(user.displayName?.[0] || user.email?.[0] || 'U').toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <p className="font-bold text-slate-900">{user.displayName || 'Anonymous Investor'}</p>
                              {user.uid === currentUser?.uid && (
                                <span className="text-[8px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">Self</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 font-medium">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <button 
                          onClick={() => handleRoleChange(user.uid, user.role)}
                          disabled={user.uid === currentUser?.uid}
                          className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${
                            user.role === 'admin' 
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
                          disabled={user.uid === currentUser?.uid}
                          className={`px-3 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center ${
                            user.status === 'active' 
                              ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' 
                              : 'bg-rose-50 text-rose-600 border border-rose-100'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full mr-2 ${user.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                          {user.status}
                        </button>
                      </td>
                      <td className="px-8 py-5">
                        <p className="text-xs text-slate-400 font-bold">{new Date(user.lastLogin).toLocaleDateString()}</p>
                        <p className="text-[10px] text-slate-300 font-medium uppercase tracking-tighter">{new Date(user.lastLogin).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button 
                          onClick={() => handleDeleteUser(user.uid)}
                          disabled={user.uid === currentUser?.uid}
                          className="p-3 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-0"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && !loading && !error && (
                    <tr>
                      <td colSpan={5} className="px-8 py-20 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">
                        No identities found in the institutional registry.
                      </td>
                    </tr>
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
                  disabled={isPurging || users.length <= 1}
                  className={`px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-xl ${
                    isPurging || users.length <= 1
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