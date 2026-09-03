import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";

export default function ProtectedRoute({ roles }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) {
    return <div className="p-8 text-dim text-sm">Loading…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    return (
      <div className="p-8" data-testid="forbidden">
        <div className="text-[11px] uppercase tracking-[0.22em] text-dim">403</div>
        <h1 className="font-display text-3xl mt-1">Not allowed</h1>
        <p className="text-sm text-dim mt-2">
          This area requires {roles.join(" or ")} access. You are signed in as <strong>{user.role}</strong>.
        </p>
      </div>
    );
  }
  return <Outlet />;
}
