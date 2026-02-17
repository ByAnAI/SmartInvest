
import React, { useState, useEffect } from 'react';
import { auth } from '../services/firebase';
import { Note } from '../types';
import { getNotes, addNote, deleteNote } from '../services/firestoreService';

const MyNotes: React.FC = () => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const user = auth.currentUser;

  const fetchNotes = async () => {
    if (!user) return;
    try {
      const data = await getNotes(user.uid);
      setNotes(data);
    } catch (e) { console.error(e); } 
    finally { setLoading(false); }
  };

  useEffect(() => { fetchNotes(); }, [user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setSubmitting(true);
    try {
      await addNote(user.uid, title, content);
      setTitle('');
      setContent('');
      setShowModal(false);
      fetchNotes();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteNote(user.uid, id);
      setNotes(notes.filter(n => n.id !== id));
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Intelligence Notes</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Encrypted Memos</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="px-5 py-3 bg-emerald-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
        >
          + New Note
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {notes.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-[2rem]">
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">No memos found.</p>
          </div>
        ) : (
          notes.map(note => (
            <div key={note.id} className="bg-yellow-50/50 p-6 rounded-[2rem] border border-yellow-100 shadow-sm relative group hover:shadow-md transition-all">
              <h3 className="font-bold text-slate-900 mb-2 pr-6">{note.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed line-clamp-4">{note.content}</p>
              <div className="mt-4 pt-4 border-t border-yellow-100/50 flex justify-between items-center">
                <span className="text-[10px] text-yellow-600/60 font-black uppercase tracking-widest">
                  {note.createdAt?.seconds ? new Date(note.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
                </span>
              </div>
              <button 
                onClick={() => handleDelete(note.id)}
                className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
              >
                🗑️
              </button>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-6">Draft Intelligence Memo</h3>
            <form onSubmit={handleSave} className="space-y-4">
              <input 
                autoFocus
                type="text" 
                placeholder="Subject Line"
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
              <textarea 
                placeholder="Memo content..."
                rows={5}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-slate-600 outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                value={content}
                onChange={e => setContent(e.target.value)}
              />
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-50">Discard</button>
                <button type="submit" disabled={submitting} className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-200">
                  {submitting ? 'Encrypting...' : 'Save Memo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyNotes;
