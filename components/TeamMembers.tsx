
import React, { useState, useEffect } from 'react';
import { auth } from '../services/firebase';
import { TeamMember } from '../types';
import { getTeamMembers, addTeamMember, deleteTeamMember } from '../services/firestoreService';

const TeamMembers: React.FC = () => {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  const [name, setName] = useState('');
  const [role, setRole] = useState('Analyst');
  const [submitting, setSubmitting] = useState(false);

  const user = auth.currentUser;

  const fetchMembers = async () => {
    if (!user) return;
    try {
      const data = await getTeamMembers(user.uid);
      setMembers(data);
    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchMembers(); }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim()) return;
    setSubmitting(true);
    try {
      await addTeamMember(user.uid, name, role);
      setName('');
      setRole('Analyst');
      setShowModal(false);
      fetchMembers();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteTeamMember(user.uid, id);
      setMembers(members.filter(m => m.id !== id));
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-slate-800 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Team Roster</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Authorized Personnel</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-700 transition-all shadow-xl active:scale-95"
        >
          + Add Member
        </button>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-50">
          {members.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest italic">
              No additional personnel assigned.
            </div>
          ) : (
            members.map(member => (
              <div key={member.id} className="flex items-center justify-between p-6 hover:bg-slate-50 transition-colors group">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-emerald-500 text-white flex items-center justify-center font-black text-lg shadow-md">
                    {member.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{member.name}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black uppercase tracking-widest border border-slate-200">
                      {member.role}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest hidden sm:inline-block">
                    Added {member.createdAt?.seconds ? new Date(member.createdAt.seconds * 1000).toLocaleDateString() : ''}
                  </span>
                  <button 
                    onClick={() => handleDelete(member.id)}
                    className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-6">Authorize New Member</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <input 
                autoFocus
                type="text" 
                placeholder="Full Name"
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                value={name}
                onChange={e => setName(e.target.value)}
              />
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Role Designation</label>
                <select 
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
                  value={role}
                  onChange={e => setRole(e.target.value)}
                >
                  <option>Analyst</option>
                  <option>Trader</option>
                  <option>Auditor</option>
                  <option>Manager</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 shadow-xl">
                  {submitting ? 'Adding...' : 'Authorize'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeamMembers;
