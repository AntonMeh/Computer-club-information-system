import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, onUnauthorized, setToken } from "../api.js";

const AuthContext = createContext(null);

const CLUB_STORAGE_KEY = "club_selected_id";
const COMPACT_STORAGE_KEY = "club_compact_tables";

const SATISFIES = {
  view: new Set(["view", "repair", "full"]),
  repair: new Set(["repair", "full"]),
  full: new Set(["full"]),
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const [clubs, setClubs] = useState([]);
  const [selectedClubId, setSelectedClubIdState] = useState(() => {
    try {
      const saved = localStorage.getItem(CLUB_STORAGE_KEY);
      return saved && saved !== "all" ? Number(saved) : null;
    } catch {
      return null;
    }
  });
  const [compactTables, setCompactTablesState] = useState(() => {
    try {
      return localStorage.getItem(COMPACT_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const logout = useCallback(() => {
    api.auth.logout();
    setUser(null);
    setClubs([]);
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setToken(null);
      setUser(null);
    });
    return () => onUnauthorized(null);
  }, []);

  const reloadClubs = useCallback(async (currentUser = user) => {
    if (!currentUser || currentUser.must_change_password) return;
    // Якщо користувач прив'язаний до одного клубу, його клуб відомий із /auth/me
    if (currentUser.club_id != null) {
      setClubs([
        {
          club_id: currentUser.club_id,
          name: currentUser.club_name || `Клуб № ${currentUser.club_id}`,
        },
      ]);
      return;
    }
    // Для користувачів з доступом до всієї мережі підвантажуємо перелік клубів
    if (currentUser.permissions?.clubs) {
      try {
        const data = await api.get("/clubs");
        const list = Array.isArray(data) ? data : data?.items || [];
        setClubs(list);
      } catch {
        setClubs([]);
      }
    }
  }, [user]);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return null;
    }
    try {
      const me = await api.auth.me();
      setUser(me);
      if (me.club_id != null) {
        setSelectedClubIdState(me.club_id);
      }
      await reloadClubs(me);
      return me;
    } catch {
      setToken(null);
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [reloadClubs]);

  useEffect(() => {
    if (getToken()) {
      refreshUser();
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = useCallback(async (username, password) => {
    const res = await api.auth.login(username, password);
    setUser(res.user);
    if (res.user.club_id != null) {
      setSelectedClubIdState(res.user.club_id);
    }
    await reloadClubs(res.user);
    return res.user;
  }, [reloadClubs]);

  const setSelectedClubId = useCallback(
    (clubId) => {
      if (user?.club_id != null) return; // прив'язаний користувач не може змінити клуб
      const normalized = clubId ? Number(clubId) : null;
      setSelectedClubIdState(normalized);
      try {
        localStorage.setItem(CLUB_STORAGE_KEY, normalized ? String(normalized) : "all");
      } catch {
        /* ігноруємо помилки localStorage */
      }
    },
    [user]
  );

  const setCompactTables = useCallback((value) => {
    const next = Boolean(value);
    setCompactTablesState(next);
    try {
      localStorage.setItem(COMPACT_STORAGE_KEY, String(next));
    } catch {
      /* ігноруємо помилки localStorage */
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("compact-tables", compactTables);
  }, [compactTables]);

  const can = useCallback(
    (section, required = "view") => {
      if (!user?.permissions) return false;
      const level = user.permissions[section];
      if (!level) return false;
      return SATISFIES[required]?.has(level) ?? false;
    },
    [user]
  );

  const effectiveClubId = user?.club_id != null ? user.club_id : selectedClubId;

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      refreshUser,
      can,
      clubs,
      reloadClubs,
      selectedClubId: effectiveClubId,
      setSelectedClubId,
      compactTables,
      setCompactTables,
    }),
    [
      user,
      loading,
      login,
      logout,
      refreshUser,
      can,
      clubs,
      reloadClubs,
      effectiveClubId,
      setSelectedClubId,
      compactTables,
      setCompactTables,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth має використовуватися всередині AuthProvider");
  return ctx;
}
