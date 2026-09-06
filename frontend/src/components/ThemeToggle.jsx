import { useEffect, useState } from "react";

function ThemeToggle() {
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  function toggleTheme() {
    document.body.classList.toggle("dark");

    const isDark = document.body.classList.contains("dark");
    setDark(isDark);

    localStorage.setItem("theme", isDark ? "dark" : "light");
  }

  return (
    <button className="theme-toggle" onClick={toggleTheme}>
      {dark ? "☀️ Claro" : "🌙 Escuro"}
    </button>
  );
}

export default ThemeToggle;