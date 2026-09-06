import useInitialLoad from "../components/useInitialLoad.js";
import { useCallback, useState } from "react";
import api from "../api/api.js";

import { AuthContext } from "./auth.js";

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(() => Boolean(localStorage.getItem("@biblioconnect:token")));

  const carregarUsuarioLogado = useCallback(async () => {
    const token = localStorage.getItem("@biblioconnect:token");

    if (!token) {
      return;
    }

    try {
      const response = await api.get("/me");
      setUsuario(response.data);
    } catch {
      localStorage.removeItem("@biblioconnect:token");
      localStorage.removeItem("@biblioconnect:usuario");
      setUsuario(null);
    } finally {
      setLoadingAuth(false);
    }
  }, []);

  async function login(email, senha) {
    const response = await api.post("/login", {
      email,
      senha,
    });

    const { token, usuario } = response.data;

    localStorage.setItem("@biblioconnect:token", token);

    // Depois de salvar o token, busca o perfil completo (incluindo endereço),
    // usado pela cotação de entrega sem obrigar o cliente a digitar tudo de novo.
    let usuarioCompleto = usuario;
    try {
      const meResponse = await api.get("/me");
      usuarioCompleto = meResponse.data;
    } catch {
      // O login continua válido mesmo se a consulta complementar falhar.
    }

    localStorage.setItem("@biblioconnect:usuario", JSON.stringify(usuarioCompleto));
    setUsuario(usuarioCompleto);

    return usuarioCompleto;
  }

  async function register(dados) {
    const response = await api.post("/usuarios", dados);
    return response.data;
  }

  async function resendConfirmation(email) {
    const response = await api.post("/reenviar-confirmacao", { email });
    return response.data;
  }

  function logout() {
    localStorage.removeItem("@biblioconnect:token");
    localStorage.removeItem("@biblioconnect:usuario");
    setUsuario(null);
  }

  useInitialLoad(carregarUsuarioLogado);

  const isAuthenticated = !!usuario;
  const isAdmin = usuario?.role === "ADMIN";

  return (
    <AuthContext.Provider
      value={{
        usuario,
        isAuthenticated,
        isAdmin,
        loadingAuth,
        login,
        register,
        resendConfirmation,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
