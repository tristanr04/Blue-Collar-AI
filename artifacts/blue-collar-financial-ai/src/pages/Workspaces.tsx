import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import {
  Building2, Users, Plus, Trash2, Crown, Shield, User, Send,
  CheckCircle, Copy, Loader2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  listWorkspaces,
  createWorkspace,
  listMembers,
  sendInvitation,
  removeMember,
  promoteToAdmin,
  transferOwnership,
  type Workspace,
  type WorkspaceMembership,
} from '@/lib/workspaces-api';

export default function Workspaces() {
  const { getToken, userId } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Workspace | null>(null);
  const [members, setMembers] = useState<WorkspaceMembership[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create workspace form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSeats, setNewSeats] = useState(5);
  const [creating, setCreating] = useState(false);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Transfer form
  const [transferTo, setTransferTo] = useState('');
  const [showTransfer, setShowTransfer] = useState(false);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      if (!token) return;
      const ws = await listWorkspaces(token);
      setWorkspaces(ws);
      if (ws.length > 0 && !selected) setSelected(ws[0]);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load workspaces.');
    } finally {
      setLoading(false);
    }
  };

  const loadMembers = async (ws: Workspace) => {
    try {
      setLoadingMembers(true);
      const token = await getToken();
      if (!token) return;
      const ms = await listMembers(token, ws.id);
      setMembers(ms);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load members.');
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => { loadWorkspaces(); }, []);

  useEffect(() => {
    if (selected) loadMembers(selected);
  }, [selected]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      setCreating(true);
      const token = await getToken();
      if (!token) return;
      const ws = await createWorkspace(token, newName.trim(), newSeats);
      setWorkspaces((prev) => [...prev, ws]);
      setSelected(ws);
      setShowCreate(false);
      setNewName('');
      setNewSeats(5);
    } catch (e: any) {
      setError(e.message ?? 'Failed to create workspace.');
    } finally {
      setCreating(false);
    }
  };

  const handleInvite = async () => {
    if (!selected || !inviteEmail.trim()) return;
    try {
      setInviting(true);
      const token = await getToken();
      if (!token) return;
      const result = await sendInvitation(token, selected.id, inviteEmail.trim(), inviteRole);
      setInviteToken(result.token);
      setInviteEmail('');
      await loadMembers(selected);
    } catch (e: any) {
      setError(e.message ?? 'Failed to send invitation.');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (targetUserId: string) => {
    if (!selected) return;
    try {
      const token = await getToken();
      if (!token) return;
      await removeMember(token, selected.id, targetUserId);
      await loadMembers(selected);
    } catch (e: any) {
      setError(e.message ?? 'Failed to remove member.');
    }
  };

  const handlePromote = async (targetUserId: string) => {
    if (!selected) return;
    try {
      const token = await getToken();
      if (!token) return;
      await promoteToAdmin(token, selected.id, targetUserId);
      await loadMembers(selected);
    } catch (e: any) {
      setError(e.message ?? e.toString());
    }
  };

  const handleTransfer = async () => {
    if (!selected || !transferTo.trim()) return;
    try {
      const token = await getToken();
      if (!token) return;
      await transferOwnership(token, selected.id, transferTo.trim());
      await loadMembers(selected);
      await loadWorkspaces();
      setShowTransfer(false);
      setTransferTo('');
    } catch (e: any) {
      setError(e.message ?? 'Failed to transfer ownership.');
    }
  };

  const copyToken = () => {
    if (!inviteToken) return;
    navigator.clipboard.writeText(inviteToken).catch(() => {});
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const myMembership = members.find((m) => m.userId === userId);
  const isOwner = myMembership?.role === 'owner';
  const isAdmin = myMembership?.role === 'admin' || isOwner;

  const RoleIcon = ({ role }: { role: string }) =>
    role === 'owner' ? <Crown className="w-3.5 h-3.5 text-amber-400" />
    : role === 'admin' ? <Shield className="w-3.5 h-3.5 text-blue-400" />
    : <User className="w-3.5 h-3.5 text-slate-400" />;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Business Workspaces</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Collaborate with your crew — invite members, manage roles.
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => setShowCreate(true)}
        >
          <Plus className="w-4 h-4 mr-1" /> New Workspace
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-sm text-destructive flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
          <button className="ml-auto underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {showCreate && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader><CardTitle className="text-base">Create Workspace</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Workspace Name *</Label>
                <Input placeholder="e.g. Pike Electric Crew" value={newName}
                  onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Max Seats</Label>
                <Input type="number" min={2} max={500} value={newSeats}
                  onChange={(e) => setNewSeats(parseInt(e.target.value) || 5)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={handleCreate} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                {creating ? 'Creating…' : 'Create'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-medium">No workspaces yet.</p>
          <p className="text-sm mt-1">Create one to invite your crew.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Workspace list */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Your Workspaces
            </p>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => setSelected(ws)}
                className={`w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  selected?.id === ws.id
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border hover:bg-white/5 text-muted-foreground'
                }`}
              >
                <div className="font-medium text-sm">{ws.name}</div>
                <div className="text-xs mt-0.5 opacity-70">
                  {ws.maxSeats} seats · {ws.plan}
                </div>
              </button>
            ))}
          </div>

          {/* Members panel */}
          {selected && (
            <div className="md:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">{selected.name}</h2>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-8"
                    onClick={() => { setShowInvite(!showInvite); setInviteToken(null); }}
                  >
                    <Send className="w-3 h-3 mr-1" /> Invite
                  </Button>
                )}
              </div>

              {/* Invite form */}
              {showInvite && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="p-4 space-y-3">
                    {inviteToken ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Invitation sent! Share this token:</p>
                        <div className="flex gap-2">
                          <Input readOnly value={inviteToken} className="font-mono text-xs h-8" />
                          <Button size="sm" variant="outline" className="h-8" onClick={copyToken}>
                            {copiedToken ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          This token is shown once only. Share it securely — valid 7 days.
                        </p>
                        <Button size="sm" variant="outline" className="h-8"
                          onClick={() => { setInviteToken(null); setShowInvite(false); }}>
                          Done
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-2 flex-wrap">
                        <Input
                          type="email"
                          placeholder="crew@example.com"
                          className="h-8 text-sm flex-1"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                        />
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                        <Button
                          size="sm"
                          className="bg-primary hover:bg-primary/90 text-primary-foreground h-8"
                          onClick={handleInvite}
                          disabled={inviting || !inviteEmail.trim()}
                        >
                          {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Send'}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Members table */}
              {loadingMembers ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-2">
                  {members.filter((m) => m.status !== 'removed').map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between p-3 rounded-xl border border-border bg-card"
                    >
                      <div className="flex items-center gap-2">
                        <RoleIcon role={m.role} />
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {m.userId === userId ? 'You' : (m.userId ?? m.invitedEmail ?? 'Pending')}
                          </div>
                          <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge
                          variant="outline"
                          className={`text-xs ${m.status === 'active' ? 'border-emerald-500/30 text-emerald-400' : 'border-yellow-500/30 text-yellow-400'}`}
                        >
                          {m.status}
                        </Badge>
                        {isOwner && m.userId !== userId && m.role !== 'owner' && m.status === 'active' && (
                          <>
                            {m.role === 'member' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-blue-400 hover:text-blue-300"
                                onClick={() => m.userId && handlePromote(m.userId)}
                              >
                                Make Admin
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              onClick={() => m.userId && handleRemove(m.userId)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Transfer ownership */}
              {isOwner && (
                <div className="border-t border-border pt-4">
                  {showTransfer ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Transfer ownership to member ID:</p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="User ID of new owner"
                          className="h-8 text-sm flex-1"
                          value={transferTo}
                          onChange={(e) => setTransferTo(e.target.value)}
                        />
                        <Button
                          size="sm"
                          className="h-8 bg-amber-500 hover:bg-amber-600 text-white"
                          onClick={handleTransfer}
                          disabled={!transferTo.trim()}
                        >
                          Transfer
                        </Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setShowTransfer(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => setShowTransfer(true)}
                    >
                      Transfer workspace ownership
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
