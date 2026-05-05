import { useEffect, useState } from "react";
import KioskPage  from "./pages/kiosk/KioskPage";
import AdminPage  from "./pages/admin/AdminPage";
import CameraNav  from "./pages/camera/CameraNav";
import CameraPage from "./pages/camera/CameraPage";
import DevPage    from "./pages/dev/DevPage";

export default function AppRouter() {
  const [isAdminAuth, setIsAdminAuth] = useState(() => !!localStorage.getItem("admin_token"));
  const [currentPage, setCurrentPage] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("/test") && !!localStorage.getItem("admin_token")) return "test";
    if (path.includes("/admin")) return "admin";
    if (path.includes("/dev"))   return "dev";
    return "kiosk";
  });

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      if (path.includes("/test") && isAdminAuth) setCurrentPage("test");
      else if (path.includes("/admin"))           setCurrentPage("admin");
      else if (path.includes("/dev"))             setCurrentPage("dev");
      else                                        setCurrentPage("kiosk");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isAdminAuth]);

  const navigateTo = (page) => {
    if (page === "test" && !isAdminAuth) page = "admin";
    setCurrentPage(page);
    const paths = { test: "/test", kiosk: "/kiosk", admin: "/admin", dev: "/dev" };
    window.history.pushState({}, "", paths[page] ?? "/kiosk");
  };

  const handleAuthChange = (authenticated) => {
    setIsAdminAuth(authenticated);
    if (!authenticated && currentPage === "test") {
      setCurrentPage("kiosk");
      window.history.pushState({}, "", "/kiosk");
    }
  };

  if (currentPage === "admin") {
    return <AdminPage onAuthChange={handleAuthChange} onNavigate={navigateTo} isAdminAuth={isAdminAuth} />;
  }

  if (currentPage === "test" && isAdminAuth) {
    return (
      <div className="app-wrapper">
        <CameraNav onNavigate={navigateTo} />
        <CameraPage />
      </div>
    );
  }

  if (currentPage === "dev") {
    return <DevPage onNavigate={navigateTo} />;
  }

  return <KioskPage onAdminRequest={() => navigateTo("admin")} />;
}
