
import React, { useState, useEffect, useCallback } from 'react';
import { NewsBoardPost } from '../types';
import { getNewsBoardPosts, addNewsBoardPost, deleteNewsBoardPost } from '../services/supabaseService';

interface NewsBoardProps {
  user: { id: string; email?: string | null; user_metadata?: { full_name?: string } | null };
  userMetadata: { displayName?: string } | null;
  isAdmin: boolean;
  /** When true, show a small hint that this is the standalone test page. */
  standalone?: boolean;
}

const NewsBoard: React.FC<NewsBoardProps> = ({ user, userMetadata, isAdmin, standalone }) => {
  const [posts, setPosts] = useState<NewsBoardPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const displayName =
    userMetadata?.displayName ||
    user.user_metadata?.full_name ||
    (user.email ? user.email.split('@')[0] : 'Member');

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getNewsBoardPosts();
      setPosts(data);
    } catch (e: any) {
      const msg = e?.message || 'Could not load the news board.';
      setError(
        /news_board_posts|schema|relation|does not exist/i.test(String(msg))
          ? 'News board table is missing from this database.'
          : msg
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const canDelete = (post: NewsBoardPost) =>
    post.author_uid === user.id || isAdmin;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !user.id) return;
    setSubmitting(true);
    setError(null);
    try {
      await addNewsBoardPost({
        authorUid: user.id,
        authorEmail: user.email || '',
        authorDisplayName: displayName,
        title: title.trim(),
        body: body.trim(),
      });
      setTitle('');
      setBody('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to post.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (postId: string) => {
    if (!confirm('Remove this post from the news board?')) return;
    try {
      await deleteNewsBoardPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e: any) {
      setError(e?.message || 'Could not delete (check permissions).');
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-24 md:pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">News Board</h2>
          <p className="text-slate-500 text-sm mt-1">
            Team announcements and discussion — visible to all signed-in members and admins.
          </p>
          {standalone && (
            <p className="text-[11px] text-indigo-600 font-bold uppercase tracking-widest mt-2">
              Standalone preview · same data as the main app
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="shrink-0 px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider hover:bg-slate-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short headline"
            maxLength={200}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should the team know?"
            rows={4}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 outline-none text-sm resize-y min-h-[120px]"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors shadow-lg shadow-indigo-500/20"
          >
            {submitting ? 'Posting…' : 'Post to board'}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/80">
          <p className="text-slate-500 text-sm font-medium">No posts yet — be the first to share an update.</p>
        </div>
      ) : (
        <ul className="space-y-4">
          {posts.map((post) => (
            <li
              key={post.id}
              className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm hover:shadow-md transition-shadow relative group"
            >
              <div className="flex justify-between gap-4 items-start">
                <div className="min-w-0">
                  <h3 className="font-bold text-lg text-slate-900">{post.title}</h3>
                  <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-wide">
                    {post.author_display_name || post.author_email || 'Member'}
                    {' · '}
                    {post.created_at
                      ? new Date(post.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : ''}
                  </p>
                </div>
                {canDelete(post) && (
                  <button
                    type="button"
                    onClick={() => handleDelete(post.id)}
                    className="shrink-0 text-slate-400 hover:text-rose-600 p-2 rounded-lg hover:bg-rose-50 opacity-90"
                    aria-label="Delete post"
                  >
                    🗑️
                  </button>
                )}
              </div>
              {post.body ? (
                <p className="mt-4 text-slate-700 whitespace-pre-wrap leading-relaxed text-sm">{post.body}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default NewsBoard;
