import { Navigate } from "react-router-dom";
import { useAuth } from "../context/auth.js";

function ProtectedRoute({ children }) {
  const { isAuthenticated, loadingAuth } = useAuth();

  if (loadingAuth) {
    return (
      <main className="page">
        <div className="container">
          <p className="page-subtitle">Verificando autenticação...</p>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

export default ProtectedRoute;