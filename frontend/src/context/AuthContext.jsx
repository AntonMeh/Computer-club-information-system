import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const userRef = useRef(null);
  const authSeqRef = useRef(0);

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

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const logout = useCallback(() => {
    authSeqRef.current += 1;
    api.auth.logout();
    userRef.current = null;
    setUser(null);
    setClubs([]);
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      authSeqRef.current += 1;
      setToken(null);
      userRef.current = null;
      setUser(null);
    });
    return () => onUnauthorized(null);
  }, []);

  const reloadClubs = useCallback(async (targetUser) => {
    const currentUser = targetUser ?? userRef.current;
    if (!currentUser || currentUser.must_change_password || !getToken()) return;
    if (currentUser.club_id != null) {
      setClubs([
        {
          club_id: currentUser.club_id,
          name: currentUser.club_name || `Клуб № ${currentUser.club_id}`,
        },
      ]);
      return;
    }
    if (currentUser.permissions?.clubs) {
      try {
        const data = await api.get("/clubs");
        const list = Array.isArray(data) ? data : data?.items || [];
        setClubs(list);
        setSelectedClubIdState((prev) => {
          if (prev != null && !list.some((c) => c.club_id === prev)) {
            try {
              localStorage.setItem(CLUB_STORAGE_KEY, "all");
            } catch {
              /* ігноруємо */
            }
            return null;
          }
          return prev;
        });
      } catch {
        setClubs([]);
      }
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken()) {
      userRef.current = null;
      setUser(null);
      setLoading(false);
      return null;
    }
    const seq = ++authSeqRef.current;
    try {
      const me = await api.auth.me();
      if (seq !== authSeqRef.current || !getToken()) return null;
      userRef.current = me;
      setUser(me);
      if (me.club_id != null) {
        setSelectedClubIdState(me.club_id);
      }
      await reloadClubs(me);
      return me;
    } catch {
      if (seq === authSeqRef.current) {
        setToken(null);
        userRef.current = null;
        setUser(null);
      }
      return null;
    } finally {
      if (seq === authSeqRef.current) {
        setLoading(false);
      }
    }
  }, [reloadClubs]);

  // Перевіряємо поточну сесію лише один раз при старті застосунку
  useEffect(() => {
    if (getToken()) {
      refreshUser();
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  const login = useCallback(
    async (username, password) => {
      const seq = ++authSeqRef.current;
      const res = await api.auth.login(username, password);
      if (seq !== authSeqRef.current) return res.user;
      userRef.current = res.user;
      setUser(res.user);
      if (res.user.club_id != null) {
        setSelectedClubIdState(res.user.club_id);
      }
      await reloadClubs(res.user);
      return res.user;
    },
    [reloadClubs]
  );

  const setSelectedClubId = useCallback(
    (clubId) => {
      if (user?.club_id != null) return;
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
