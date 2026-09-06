import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { AuthProvider } from "./context/AuthContext.jsx";

import Navbar from "./components/Navbar.jsx";
import AdminRoute from "./components/AdminRoute.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

const Home = lazy(() => import("./pages/Home.jsx"));
const Books = lazy(() => import("./pages/Books.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Register = lazy(() => import("./pages/Register.jsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.jsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.jsx"));

const AdminDashboard = lazy(() => import("./pages/AdminDashboard.jsx"));
const AddBook = lazy(() => import("./pages/AddBooks.jsx"));
const AdminBooks = lazy(() => import("./pages/AdminBooks.jsx"));
const EditBook = lazy(() => import("./pages/EditBook.jsx"));
const AdminUsers = lazy(() => import("./pages/AdminUsers.jsx"));
const AdminDelays = lazy(() => import("./pages/AdminDelays.jsx"));
const AdminOrders = lazy(() => import("./pages/AdminOrders.jsx"));
const AdminFinance = lazy(() => import("./pages/AdminFinance.jsx"));

const MyOrders = lazy(() => import("./pages/MyOrders.jsx"));
const OrderSuccess = lazy(() => import("./pages/OrderSuccess.jsx"));
const OrderReceipt = lazy(() => import("./pages/OrderReceipt.jsx"));
const BookReviews = lazy(() => import("./pages/BookReviews.jsx"));
const ClientChat = lazy(() => import("./pages/ClientChat.jsx"));
const AdminReviews = lazy(() => import("./pages/AdminReviews.jsx"));
const AdminChat = lazy(() => import("./pages/AdminChat.jsx"));
const AdminDeliveries = lazy(() => import("./pages/AdminDeliveries.jsx"));

import "./styles/global.css";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Navbar />

        <Suspense fallback={<main className="page"><div className="container" role="status">Carregando página...</div></main>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/livros" element={<Books />} />
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/esqueci-senha" element={<ForgotPassword />} />
          <Route path="/redefinir-senha/:token" element={<ResetPassword />} />

          <Route path="/livros/:id/avaliacoes" element={<BookReviews />} />

          <Route
            path="/chat"
            element={
              <ProtectedRoute>
                <ClientChat />
              </ProtectedRoute>
            }
          />

          <Route
            path="/meus-pedidos"
            element={
              <ProtectedRoute>
                <MyOrders />
              </ProtectedRoute>
            }
          />

          <Route
            path="/pedido-confirmado/:id"
            element={
              <ProtectedRoute>
                <OrderSuccess />
              </ProtectedRoute>
            }
          />

          <Route
            path="/comprovante/:id"
            element={
              <ProtectedRoute>
                <OrderReceipt />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/livros"
            element={
              <AdminRoute>
                <AdminBooks />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/pedidos"
            element={
              <AdminRoute>
                <AdminOrders />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/financeiro"
            element={
              <AdminRoute>
                <AdminFinance />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/usuarios"
            element={
              <AdminRoute>
                <AdminUsers />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/atrasos"
            element={
              <AdminRoute>
                <AdminDelays />
              </AdminRoute>
            }
          />


          <Route
            path="/admin/avaliacoes"
            element={
              <AdminRoute>
                <AdminReviews />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/chat"
            element={
              <AdminRoute>
                <AdminChat />
              </AdminRoute>
            }
          />

          <Route
            path="/admin/entregas"
            element={
              <AdminRoute>
                <AdminDeliveries />
              </AdminRoute>
            }
          />

          <Route
            path="/adicionar-livro"
            element={
              <AdminRoute>
                <AddBook />
              </AdminRoute>
            }
          />

          <Route
            path="/editar-livro/:id"
            element={
              <AdminRoute>
                <EditBook />
              </AdminRoute>
            }
          />

          <Route
            path="*"
            element={
              <main className="page">
                <div className="container">
                  <h1 className="page-title">Página não encontrada</h1>
                  <p className="page-subtitle">
                    Essa rota ainda não foi configurada.
                  </p>
                </div>
              </main>
            }
          />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;