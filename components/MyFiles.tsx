
import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Folder, FileItem } from '../types';
import { getFolders, addFolder, deleteFolder } from '../services/supabaseService';
// Note: getFiles, addFile, deleteFile are not yet fully implemented in supabaseService
// We'll keep them as placeholder imports for now if they exist, or mock them
const getFiles = async (uid: string) => [] as FileItem[];
const addFile = async (uid: string, name: string, size: string) => { };
const deleteFile = async (uid: string, id: string) => { };

const MyFiles: React.FC = () => {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showFileModal, setShowFileModal] = useState(false);

  // Form State
  const [newItemName, setNewItemName] = useState('');
  const [newFileSize, setNewFileSize] = useState('2 MB');
  const [submitting, setSubmitting] = useState(false);

  const [currentUid, setCurrentUid] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUid(data.user?.id || null);
    });
  }, []);

  const fetchData = async () => {
    if (!currentUid) return;
    try {
      const [foldersData, filesData] = await Promise.all([
        getFolders(currentUid),
        getFiles(currentUid)
      ]);
      setFolders(foldersData);
      setFiles(filesData);
    } catch (e) {
      console.error("Error fetching files:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentUid]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUid || !newItemName.trim()) return;
    setSubmitting(true);
    try {
      await addFolder(currentUid, newItemName);
      setNewItemName('');
      setShowFolderModal(false);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUid || !newItemName.trim()) return;
    setSubmitting(true);
    try {
      // Logic for adding a file (mock size for UI simulation as per requirement "metadata only")
      const randomSize = (Math.random() * 10 + 1).toFixed(1) + ' MB';
      await addFile(currentUid, newItemName, randomSize);
      setNewItemName('');
      setShowFileModal(false);
      fetchData();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!currentUid) return;
    try {
      await deleteFolder(currentUid, id);
      setFolders(folders.filter(f => f.id !== id));
    } catch (e) { console.error(e); }
  };

  const handleDeleteFile = async (id: string) => {
    if (!currentUid) return;
    try {
      await deleteFile(currentUid, id);
      setFiles(files.filter(f => f.id !== id));
    } catch (e) { console.error(e); }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">My Files</h2>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Secure Storage Protocol</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setShowFolderModal(true)}
            className="px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
          >
            + New Folder
          </button>
          <button
            onClick={() => setShowFileModal(true)}
            className="px-5 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            Upload File
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Folders Section */}
        {folders.map(folder => (
          <div key={folder.id} className="group relative bg-indigo-50/50 hover:bg-indigo-100/50 p-6 rounded-3xl border border-indigo-100 transition-all cursor-pointer">
            <div className="text-4xl mb-4 text-indigo-500">📁</div>
            <h3 className="font-bold text-slate-800">{folder.name}</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              {folder.createdAt?.seconds ? new Date(folder.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
              className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* Files List */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-50 bg-slate-50/30">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Recent Uploads</h3>
        </div>
        <div className="divide-y divide-slate-50">
          {files.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs font-bold uppercase tracking-widest italic">
              No files archived in vault.
            </div>
          ) : (
            files.map(file => (
              <div key={file.id} className="flex items-center justify-between p-6 hover:bg-slate-50 transition-colors group">
                <div className="flex items-center space-x-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-lg">📄</div>
                  <div>
                    <p className="font-bold text-slate-800 text-sm">{file.name}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase">{file.size}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <span className="text-[10px] text-slate-300 font-bold uppercase tracking-widest">
                    {file.createdAt?.seconds ? new Date(file.createdAt.seconds * 1000).toLocaleDateString() : 'Just now'}
                  </span>
                  <button
                    onClick={() => handleDeleteFile(file.id)}
                    className="text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* New Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-6">Create New Folder</h3>
            <form onSubmit={handleCreateFolder}>
              <input
                autoFocus
                type="text"
                placeholder="Folder Name"
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 mb-6"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowFolderModal(false)} className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200">
                  {submitting ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New File Modal */}
      {showFileModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm p-8 rounded-[2rem] shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-6">Upload File Metadata</h3>
            <form onSubmit={handleCreateFile}>
              <input
                autoFocus
                type="text"
                placeholder="File Name (e.g. Q4_Report.pdf)"
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 mb-6"
                value={newItemName}
                onChange={e => setNewItemName(e.target.value)}
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowFileModal(false)} className="flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={submitting} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-200">
                  {submitting ? 'Saving...' : 'Add File'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyFiles;
