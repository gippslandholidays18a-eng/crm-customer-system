import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { LogIn } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/";

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await login(email.trim().toLowerCase(), password);
      toast.success("Signed in");
      navigate(from, { replace: true });
    } catch (e) {
      const d = e?.response?.data?.detail;
      setErr(typeof d === "string" ? d : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090A0E] flex items-center justify-center px-4 bg-grid" data-testid="login-page">
      <div className="w-full max-w-sm surface rounded-md p-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-md bg-brand flex items-center justify-center">
            <span className="text-black font-display text-base font-bold">S</span>
          </div>
          <div className="font-display text-base">Sourcebench</div>
        </div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-dim mt-4">Sign in</div>
        <h1 className="font-display text-2xl mt-1">Welcome back</h1>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Email</label>
            <Input
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="login-email"
              className="mt-1 bg-transparent border-[#22252F] focus-visible:ring-1 focus-visible:ring-[#D9A05B]"
              required
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.15em] text-dim">Password</label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="login-password"
              className="mt-1 bg-transparent border-[#22252F] focus-visible:ring-1 focus-visible:ring-[#D9A05B]"
              required
            />
          </div>
          {err && (
            <div data-testid="login-error" className="text-[#E05A50] text-xs">{err}</div>
          )}
          <button
            type="submit"
            disabled={busy}
            data-testid="login-submit"
            className="w-full inline-flex items-center justify-center gap-2 bg-brand text-black text-sm font-medium px-4 py-2.5 rounded-md hover:opacity-90 disabled:opacity-50"
          >
            <LogIn className="w-4 h-4" /> {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
